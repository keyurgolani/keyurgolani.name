const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Lua: '#000080',
  Dockerfile: '#384d54',
  HCL: '#844FBA',
  Makefile: '#427819',
  Nix: '#7e7eff',
  Elixir: '#6e4a7e',
  Erlang: '#B83998',
  Haskell: '#5e5086',
  OCaml: '#3be133',
  Zig: '#ec915c',
};

export function languageColor(name: string | null | undefined): string | null {
  if (!name) return null;
  return LANGUAGE_COLORS[name] ?? null;
}
