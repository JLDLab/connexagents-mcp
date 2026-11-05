// The only Node global used by src/. Declared here so that typescript stays the sole dev dependency.
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  exit(code: number): never
}
