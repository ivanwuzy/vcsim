"""Import the confirmed v4 bank without changing the source workbook."""
import hashlib, json, math, pathlib, re, sys, zipfile, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def read_sheets(book):
    with zipfile.ZipFile(book) as z:
        strings = [''.join(t.text or '' for t in item.findall('.//s:t', NS)) for item in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            cells, formulas = {}, {}
            for c in ET.fromstring(z.read(path)).findall('.//s:sheetData/s:row/s:c', NS):
                address, kind = c.get('r'), c.get('t')
                v, f = c.find('s:v', NS), c.find('s:f', NS)
                value = v.text if v is not None else None
                if kind == 'e': raise ValueError(f'{sheet.get("name")}!{address}: formula error {value}')
                if kind == 's': value = strings[int(value)]
                elif kind == 'inlineStr': value = ''.join(t.text or '' for t in c.findall('.//s:t', NS))
                elif value is not None: value = float(value)
                cells[address] = value
                if f is not None: formulas[address] = f.text
            sheets[sheet.get('name')] = (cells, formulas)
        return sheets

def rows_by_name(cells, column, first_row):
    rows = {}
    for address, name in cells.items():
        match = re.fullmatch(column + r'(\d+)', address)
        if not match or int(match[1]) < first_row or not name: continue
        if name in rows: raise ValueError(f'Duplicate company: {name}')
        rows[name] = int(match[1])
    return rows

def build_projects(book):
    version_match = re.search(r'v\d+\.\d+', book.stem)
    version = version_match[0] if version_match else 'v4'
    sheets = read_sheets(book)
    main, _ = sheets['题库底稿']; returns, formulas = sheets['回报测算']; sources, _ = sheets['资料口径']
    if sources.get('E7') != '进入估值及逻辑': raise ValueError('Expected v4 workbook layout; older importer is preserved in Git history.')
    main_rows = rows_by_name(main, 'A', 2); return_rows = rows_by_name(returns, 'B', 7); source_rows = rows_by_name(sources, 'B', 8)
    if len(return_rows) != 50 or main_rows.keys() != return_rows.keys() or source_rows.keys() != return_rows.keys():
        raise ValueError('All three sheets must contain the same 50 unique companies.')
    sha = hashlib.sha256(book.read_bytes()).hexdigest(); projects = []
    for name, cr in return_rows.items():
        r, sr = main_rows[name], source_rows[name]; case_id = returns[f'A{cr}']
        if case_id != sources[f'A{sr}']: raise ValueError(f'{name}: conflicting case IDs')
        year = returns.get(f'C{cr}')
        if not isinstance(year, (int, float)) or not math.isfinite(year) or year != int(year) or not 2000 <= year <= 2026:
            raise ValueError(f'{name}: invalid game entry year {year}')
        year = int(year)
        unit, entry, terminal, specified, retention, cached = (returns.get(f'{c}{cr}') for c in ['F', 'G', 'H', 'I', 'J', 'K'])
        currency = {'亿元人民币': 'CNY', '亿美元': 'USD', '指数': 'index'}.get(unit)
        if currency is None: raise ValueError(f'{name}: unknown valuation unit {unit}')
        if not isinstance(retention, (int, float)) or not math.isfinite(retention) or not 0 <= retention <= 1:
            raise ValueError(f'{name}: invalid retention')
        if f'K{cr}' not in formulas:
            if not isinstance(cached, (int, float)) or retention <= 0: raise ValueError(f'{name}: invalid confirmed settlement multiple')
            specified = cached / retention
        if specified is None:
            if not isinstance(entry, (int, float)) or not math.isfinite(entry) or entry <= 0 or not isinstance(terminal, (int, float)) or not math.isfinite(terminal) or terminal < 0:
                raise ValueError(f'{name}: missing valid valuation inputs')
            raw_multiple = terminal / entry
        else: raw_multiple = specified
        multiple = raw_multiple * retention
        if not math.isfinite(multiple) or multiple < 0: raise ValueError(f'{name}: invalid multiple')
        if not isinstance(cached, (int, float)) or not math.isclose(multiple, cached, rel_tol=1e-11, abs_tol=1e-8):
            raise ValueError(f'{name}: settlement cache differs from inputs; recalculate Excel before importing')
        basis = '人工确认回报倍率' if specified is not None else '人工确认估值比（终点÷进入估值）'
        entry_value = entry * 100_000_000 if entry is not None and currency != 'index' else entry
        terminal_value = terminal * 100_000_000 if terminal is not None and currency != 'index' else terminal
        # Retain the previous bank's qualitative trajectory for surviving companies.
        low_start = ['宇树科技', '越疆机器人', '石头科技', '普渡科技', '大疆创新', '梅卡曼德', '绿的谐波', '因时机器人', '蓝点触控', '帕西尼', 'VAST', '硅基流动', '光轮智能', '博睿康']
        category = 'B' if multiple < 1 else 'C' if name in low_start else 'A'
        trajectory = {'A': '高开高走', 'B': '高开低走', 'C': '低开高走'}[category]
        # Research notes predate the final edits: never use their older years,
        # approximate returns or "待补" status to settle the confirmed bank.
        urls = list(dict.fromkeys(re.findall(r'https?://[^\s｜]+', sources.get(f'J{sr}', ''))))
        def published(url):
            match = re.search(r'/(20\d{2})/(\d{2})/(\d{2})/', url) or re.search(r'/(20\d{2})-(\d{2})-(\d{2})/', url)
            return '-'.join(match.groups()) if match else None
        cutoff = returns.get(f'P{cr}') or '待补'; cutoff_year = re.search(r'20\d{2}', str(cutoff))
        note = (f'按用户最新人工确认的回报测算表{cr}行结算，游戏进入年为{year}，回报倍率为{multiple:.4f}倍。'
                f'持股保留系数为{retention:.0%}，不计追加投入、分红、优先权、税费与退出折价。'
                f'原研究口径（人工确认前）：{returns.get(f"E{cr}", "")}。'
                f'原估值依据：{returns.get(f"Q{cr}", "")}。原不确定性：{returns.get(f"R{cr}", "")}')
        p = {
            'id': case_id, 'name': name, 'alias': main[f'B{r}'], 'year': year, 'decisionYear': year,
            'category': category, 'real': True, 'market': 'CN',
            'robotics': main[f'C{r}'] in ['具身本体与模型', '其他机器人', '核心部件', '自动驾驶'],
            'sector': main[f'C{r}'], 'pitch': main[f'E{r}'], 'team': main[f'H{r}'], 'technical': main[f'J{r}'],
            'traction': main[f'L{r}'], 'risk': main[f'M{r}'], 'history': main[f'K{r}'],
            'lesson': '估值增长不等于投资人已实现收益。' + (returns.get(f'R{cr}') or ''),
            'sensitivity': ['产品验证', '客户与交付', '资金周期'],
            'sources': [{'url': u, 'publishedAt': published(u), 'note': 'v4原研究资料；后续报道仅供复盘，结算采用回报测算中的最新人工确认值。'} for u in urls],
            'review': 'draft', 'reviewedAt': None, 'decisionEvidence': None,
            'editorial': {
                'manualCase': True, 'sourceBook': book.name, 'sourceRow': r, 'sourceSha256': sha,
                'prototypeTeam': main[f'G{r}'], 'prototypeTechnology': main[f'I{r}'], 'prototypeBusiness': main[f'K{r}'],
                'firstFunding': main[f'N{r}'], 'cumulativeFunding': main[f'O{r}'], 'trajectory': trajectory,
                'stage': '人工确认结算', 'informationBoundary': sources[f'H{sr}'],
            },
            'valuation': {
                'method': 'manual', 'basis': basis, 'currency': currency, 'entryYear': year,
                'endYear': int(cutoff_year[0]) if cutoff_year else 2026,
                'entryYuan': entry_value if currency == 'CNY' else None, 'terminalYuan': terminal_value if currency == 'CNY' else None,
                'entryValue': entry_value, 'terminalValue': terminal_value, 'retention': retention,
                'entryRound': returns[f'D{cr}'], 'cutoff': cutoff, 'points': [],
                'reference': f'{book.name}：回报测算第{cr}行（C列游戏进入年、I列人工倍率优先、K列结算倍数）；题库底稿第{r}行；资料口径第{sr}行',
                'status': '人工确认结算', 'note': note,
            },
        }
        if specified is not None: p['valuation']['specifiedMultiple'] = specified
        for field in ['alias', 'sector', 'pitch', 'team', 'technical', 'traction', 'risk', 'history']:
            if not p[field]: raise ValueError(f'{name}: missing {field}')
        projects.append(p)
    if len({p['id'] for p in projects}) != 50: raise ValueError('Duplicate case IDs')
    manifest = {
        'version': version, 'sourceBook': str(book.relative_to(ROOT)) if book.is_relative_to(ROOT) else book.name,
        'sourceSha256': sha, 'count': 50, 'realCases': 50, 'manualCases': 50, 'overseasCases': 0,
        'years': {p['name']: p['decisionYear'] for p in projects},
        'returns': {name: returns[f'K{cr}'] for name, cr in return_rows.items()},
    }
    return projects, manifest

if __name__ == '__main__':
    book = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '具身VC投资模拟器_题库v4.3.xlsx'
    projects, manifest = build_projects(book)
    # Worksheet sorting must not reorder the existing bank and its exported review.
    previous = ROOT / 'docs/题库初稿.json'
    if previous.exists():
        order = {p['id']: i for i, p in enumerate(json.loads(previous.read_text()))}
        projects.sort(key=lambda p: order.get(p['id'], len(order)))
    text = json.dumps(projects, ensure_ascii=False, indent=2)
    (ROOT / 'data/projects.ts').write_text(f'import type {{ Project }} from "../lib/types";\n\n// Generated from the confirmed {manifest["version"]} workbook by scripts/import-question-bank.py.\nexport const PROJECTS: Project[] = ' + text + ';\n')
    (ROOT / 'docs/题库初稿.json').write_text(text + '\n')
    (ROOT / 'data/question-bank-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in manifest.items() if k not in ['returns', 'years']}, ensure_ascii=False))
