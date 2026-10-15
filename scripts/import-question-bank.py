"""Read the delivered v3 workbook; generate the game's bank without editing Excel."""
import hashlib, json, pathlib, re, sys, zipfile, xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parent.parent
book = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'outputs/20261014-v3/具身VC投资模拟器_题库v3.xlsx'
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
sha = hashlib.sha256(book.read_bytes()).hexdigest()
with zipfile.ZipFile(book) as z:
    strings = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
    def read_sheet(num):
        cells = {}
        for c in ET.fromstring(z.read(f'xl/worksheets/sheet{num}.xml')).findall('.//s:sheetData/s:row/s:c', ns):
            t = c.get('t'); v = c.find('s:v', ns); value = v.text if v is not None else None
            if t == 'e': raise ValueError(f'Workbook formula error: {c.get("r")}')
            if t == 's': value = strings[int(value)]
            elif t == 'inlineStr': value = ''.join(c.find('s:is', ns).itertext())
            elif value is not None:
                try: value = float(value)
                except ValueError: pass
            cells[c.get('r')] = value
        return cells
    main, returns, sources = (read_sheet(i) for i in [1, 2, 3])

projects = []
for i in range(50):
    r, cr, sr = i + 2, i + 7, i + 8
    name = main[f'A{r}']
    assert returns[f'B{cr}'] == sources[f'B{sr}'] == name
    unit, entry, terminal, specified, retention = (returns.get(f'{c}{cr}') for c in ['F', 'G', 'H', 'I', 'J'])
    basis = returns[f'E{cr}']; year = int(returns[f'C{cr}'])
    multiple = (specified if specified is not None else terminal / entry) * retention
    assert abs(multiple - returns[f'K{cr}']) < 1e-8
    currency = 'CNY' if unit == '亿元人民币' else 'USD' if unit == '亿美元' else 'index'
    entry_value = entry * 100_000_000 if entry is not None and currency != 'index' else entry
    terminal_value = terminal * 100_000_000 if terminal is not None and currency != 'index' else terminal
    method = 'manual' if basis.startswith('人工') else 'reference' if basis == '公开估值参考' else 'assumption'
    trajectory, stage = sources[f'F{sr}'].split('；')[:2]
    stage = stage.split('。')[0]
    urls = re.findall(r'https?://[^\s]+', sources.get(f'J{sr}', ''))
    def published(url):
        match = re.search(r'/(20\d{2})/(\d{2})/(\d{2})/', url) or re.search(r'/(20\d{2})-(\d{2})-(\d{2})/', url)
        return '-'.join(match.groups()) if match else None
    note = returns[f'R{cr}'] + ' ' + sources[f'G{sr}'] + ' 默认持股保留系数100%，不计分红、追加投入、优先权、税费或退出折价。'
    p = {
        'id': returns[f'A{cr}'], 'name': name, 'alias': main[f'B{r}'], 'year': year, 'decisionYear': year,
        'category': 'B' if trajectory == '高开低走' else 'C' if trajectory == '低开高走' else 'A',
        'real': True, 'market': 'overseas' if name in ['Scale AI', '维珍轨道（Virgin Orbit）'] else 'CN',
        'robotics': main[f'C{r}'] in ['具身本体与模型', '其他机器人', '核心部件', '自动驾驶'],
        'sector': main[f'C{r}'], 'pitch': main[f'E{r}'], 'team': main[f'H{r}'],
        'technical': main[f'J{r}'], 'traction': main[f'L{r}'], 'risk': main[f'M{r}'],
        'history': main[f'K{r}'] + '\n' + sources[f'E{sr}'],
        'lesson': sources[f'E{sr}'], 'sensitivity': ['产品验证', '客户与交付', '资金周期'],
        'sources': [{'url': u, 'publishedAt': published(u), 'note': 'v3资料来源。同期性及事实范围按原表边界；后续报道只用于复盘。'} for u in urls],
        'review': 'draft', 'reviewedAt': None, 'decisionEvidence': None,
        'editorial': {
            'manualCase': main[f'D{r}'] == '人工确认案例', 'sourceBook': book.name,
            'sourceRow': r, 'sourceSha256': sha, 'prototypeTeam': main[f'G{r}'],
            'prototypeTechnology': main[f'I{r}'], 'prototypeBusiness': main[f'K{r}'],
            'firstFunding': main[f'N{r}'], 'cumulativeFunding': main[f'O{r}'],
            'trajectory': trajectory, 'stage': stage, 'informationBoundary': sources[f'H{sr}'],
        },
        'valuation': {
            'method': method, 'basis': basis, 'currency': currency,
            'entryYear': year, 'endYear': 2025 if name == '沐曦' else 2024 if name == 'Scale AI' else 2026,
            'entryYuan': entry_value if currency == 'CNY' else None,
            'terminalYuan': terminal_value if currency == 'CNY' else None,
            'entryValue': entry_value, 'terminalValue': terminal_value,
            'retention': retention, 'entryRound': returns[f'D{cr}'], 'cutoff': returns[f'P{cr}'],
            'points': [], 'reference': f'{book.name}：回报测算第{cr}行；资料口径第{sr}行',
            'status': stage, 'note': note,
        },
    }
    if specified is not None: p['valuation']['specifiedMultiple'] = specified
    for field in ['pitch', 'team', 'technical', 'traction', 'risk', 'history']:
        assert p[field], (name, field)
    projects.append(p)
assert len({p['id'] for p in projects}) == len({p['name'] for p in projects}) == 50
text = json.dumps(projects, ensure_ascii=False, indent=2)
(root/'data/projects.ts').write_text('import type { Project } from "../lib/types";\n\n// Generated from the delivered v3 workbook by scripts/import-question-bank.py.\nexport const PROJECTS: Project[] = ' + text + ';\n')
(root/'docs/题库初稿.json').write_text(text + '\n')
manifest = {'sourceBook': str(book.relative_to(root)), 'sourceSha256': sha, 'count': 50, 'realCases': 50, 'manualCases': 7, 'overseasCases': 2, 'returns': {p['name']: round(((p['valuation'].get('specifiedMultiple', p['valuation']['terminalValue'] / p['valuation']['entryValue'] if p['valuation']['entryValue'] else 0)) * p['valuation']['retention']), 8) for p in projects}}
(root/'data/question-bank-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in manifest.items() if k != 'returns'}, ensure_ascii=False))
