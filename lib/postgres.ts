// pg connection-string SSL parameters replace its explicit SSL object.
// Supply a provider CA with full certificate/hostname validation instead.
export function postgresOptions(connectionString: string, ca?: string) {
  if (!ca) return { connectionString };
  const url = new URL(connectionString);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}
