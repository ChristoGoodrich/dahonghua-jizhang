// The corpora, shared by the parity harness and the golden runner.
//
// Extracted so `freeze-goldens.js` and `goldens.js` name the same list as
// `parity.js` did rather than a copy of it — a module missing from one of
// two lists is a module that quietly stopped being checked.

const MODULES = [
  {
    name: 'calc',
    corpus: 'rust/parity/calc-corpus.tsv',
    ts: 'scripts/calc-parity.ts',
    example: 'dump_calc',
  },
  {
    name: 'money',
    corpus: 'rust/parity/money-corpus.tsv',
    ts: 'scripts/money-parity.ts',
    example: 'dump_money',
  },
  {
    name: 'cycle',
    corpus: 'rust/parity/cycle-corpus.tsv',
    ts: 'scripts/cycle-parity.ts',
    example: 'dump_cycle',
  },
  {
    name: 'period',
    corpus: 'rust/parity/period-corpus.tsv',
    ts: 'scripts/period-parity.ts',
    example: 'dump_period',
  },
  {
    name: 'subs',
    corpus: 'rust/parity/subs-corpus.tsv',
    ts: 'scripts/subs-parity.ts',
    example: 'dump_subs',
  },
  {
    name: 'bills',
    corpus: 'rust/parity/bills-corpus.tsv',
    ts: 'scripts/bills-parity.ts',
    example: 'dump_bills',
  },
  {
    name: 'dedup',
    corpus: 'rust/parity/dedup-corpus.tsv',
    ts: 'scripts/dedup-parity.ts',
    example: 'dump_dedup',
  },
  {
    name: 'glass',
    corpus: 'rust/parity/glass-corpus.tsv',
    // Runs under jest, like the ledger: src/theme/glass.ts imports Platform
    // and StyleSheet from react-native, which esbuild will not transform.
    harness: 'scripts/glass-parity.harness.ts',
    example: 'dump_glass',
  },
  {
    name: 'inbox',
    corpus: 'rust/parity/inbox-corpus.tsv',
    // Under jest: inbox.ts imports AsyncStorage, the native capture module and
    // AppState, none of which are part of what is compared.
    harness: 'scripts/inbox-parity.harness.ts',
    example: 'dump_inbox',
  },
  {
    name: 'filter',
    corpus: 'rust/parity/filter-corpus.tsv',
    ts: 'scripts/filter-parity.ts',
    example: 'dump_filter',
  },
  {
    name: 'trends',
    corpus: 'rust/parity/trends-corpus.tsv',
    ts: 'scripts/trends-parity.ts',
    example: 'dump_trends',
  },
  {
    name: 'budget',
    corpus: 'rust/parity/budget-corpus.tsv',
    ts: 'scripts/budget-parity.ts',
    example: 'dump_budget',
  },
  {
    name: 'statement',
    corpus: 'rust/parity/statement-corpus.tsv',
    ts: 'scripts/statement-parity.ts',
    example: 'dump_statement',
  },
  {
    name: 'insight',
    corpus: 'rust/parity/insight-corpus.tsv',
    ts: 'scripts/insight-parity.ts',
    example: 'dump_insight',
  },
  {
    name: 'weekly',
    corpus: 'rust/parity/weekly-corpus.tsv',
    ts: 'scripts/weekly-parity.ts',
    example: 'dump_weekly',
  },
  {
    name: 'search',
    corpus: 'rust/parity/search-corpus.tsv',
    ts: 'scripts/search-parity.ts',
    example: 'dump_search',
  },
  {
    name: 'rates',
    corpus: 'rust/parity/rates-corpus.tsv',
    ts: 'scripts/rates-parity.ts',
    example: 'dump_rates',
  },
  {
    name: 'export',
    corpus: 'rust/parity/export-corpus.tsv',
    ts: 'scripts/export-parity.ts',
    example: 'dump_export',
  },
  {
    name: 'merge',
    corpus: 'rust/parity/merge-corpus.tsv',
    ts: 'scripts/merge-parity.ts',
    example: 'dump_merge',
  },
  {
    name: 'rows',
    corpus: 'rust/parity/rows-corpus.tsv',
    ts: 'scripts/rows-parity.ts',
    example: 'dump_rows',
  },
  {
    name: 'sync',
    corpus: 'rust/parity/sync-corpus.tsv',
    ts: 'scripts/sync-parity.ts',
    example: 'dump_sync',
  },
  {
    name: 'acct',
    corpus: 'rust/parity/acct-corpus.tsv',
    ts: 'scripts/acct-parity.ts',
    example: 'dump_acct',
  },
  {
    name: 'list',
    corpus: 'rust/parity/list-corpus.tsv',
    ts: 'scripts/list-parity.ts',
    example: 'dump_list',
  },
  {
    name: 'record',
    corpus: 'rust/parity/record-corpus.tsv',
    ts: 'scripts/record-parity.ts',
    example: 'dump_record',
  },
  {
    name: 'chart',
    corpus: 'rust/parity/chart-corpus.tsv',
    ts: 'scripts/chart-parity.ts',
    example: 'dump_chart',
  },
  {
    name: 'stats',
    corpus: 'rust/parity/stats-corpus.tsv',
    ts: 'scripts/stats-parity.ts',
    example: 'dump_stats',
  },
  {
    name: 'notif',
    corpus: 'rust/parity/notif-corpus.tsv',
    ts: 'scripts/notif-parity.ts',
    example: 'dump_notif',
  },
  {
    name: 'backup',
    corpus: 'rust/parity/backup-corpus.tsv',
    ts: 'scripts/backup-parity.ts',
    example: 'dump_backup',
  },
  {
    name: 'encoding',
    corpus: 'rust/parity/encoding-corpus.tsv',
    ts: 'scripts/encoding-parity.ts',
    example: 'dump_encoding',
  },
  {
    name: 'theme',
    corpus: 'rust/parity/theme-corpus.tsv',
    ts: 'scripts/theme-parity.ts',
    example: 'dump_theme',
  },
  {
    name: 'engine',
    corpus: 'rust/parity/engine-corpus.tsv',
    // Stateful and then some: the sync engine decides an order of operations
    // against a server, so both halves are interpreters replaying one script.
    // The TypeScript half drives the shipping engine through a faked Supabase
    // client; the Rust half executes its effects against an equivalent fake.
    harness: 'scripts/engine-parity.harness.ts',
    example: 'dump_engine',
  },
  {
    name: 'ledger',
    corpus: 'rust/parity/ledger-corpus.tsv',
    // Stateful: a ledger has no single answer, it has a history. Each corpus
    // line is a command sequence, and what gets compared is the ledger left
    // behind. The TypeScript half runs under jest because state.ts imports
    // AsyncStorage — see jest.parity.config.js.
    harness: 'scripts/ledger-parity.harness.ts',
    example: 'dump_ledger',
  },
];

module.exports = { MODULES };
