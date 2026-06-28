// i18n — ported subset of v7's I18N, growing per phase.
export type Lang = 'zh' | 'en';

export interface Strings {
  // header / core loop
  title: string; sub: string; net: string; exp: string; inc: string;
  // transfer (转账)
  xfer: string; xferFrom: string; xferTo: string; xferFee: string; xferDiscount: string;
  xferNeedAccts: string; xferLabel: string;
  list: string; cal: string; stats: string; wall: string;
  note: string; save: string; del: string; empty: string;
  today: string; yesterday: string; langBtn: string; newCat: string; amountPh: string;
  toastBloom: string; toastStreak: string; // toastStreak has %d
  importOk: string; importFail: string; comingSoon: string;
  // budget + insight
  budgetTitle: string; budgetNone: string; budgetSpentLeft: string; budgetOver: string; // %s
  // stats
  stToday: string; stAvg: string; stTop: string; stCount: string;
  byCat: string; trend: string;
  cmpTitle: string; cmpThis: string; cmpLast: string; cmpUp: string; cmpDown: string; cmpSame: string;
  // calendar
  calHint: string;
  // garden
  wallTitle: string; wallSub: string; flowersUnit: string; streakLabel: string; daysUnit: string;
  // settings
  setTitle: string; setSub: string;
  setBudget: string; setBudgetD: string; setCycle: string; setCycleD: string;
  setTheme: string; setThemeD: string; darkTitle: string; darkDesc: string;
  langTitle: string; langDesc: string; dataTitle: string; dataDesc: string; importBtn: string;
  back: string;
  // accounts
  setAccounts: string; setAccountsD: string; acctAdd: string;
  acctName: string; acctBal: string; acctSaveBtn: string; acctBalance: string; acctDefault: string;
  acctKind: string; acctKindCash: string; acctKindCredit: string; acctKindPrepaid: string; acctOwed: string;
  // net worth
  setAssets: string; setAssetsD: string; assetNet: string; assetTotal: string; assetDebt: string;
  assetAdd: string; assetAsset: string; assetLiab: string; assetName: string; assetVal: string; assetSave: string;
  // loans
  setLoans: string; setLoansD: string; loanLend: string; loanBorrow: string; loanWho: string; loanAmt: string;
  loanSave: string; loanAdd: string; loanOwedMe: string; loanIOwe: string; loanRemain: string; loanCleared: string;
  loanRepay: string; repayAmt: string; loanProgress: string;
  // search + custom category
  searchPh: string; noResult: string; newCatTitle: string; catNamePh: string; catCreate: string;
  // subscriptions
  setSubs: string; setSubsD: string; subAdd: string; subName: string; subAmtL: string;
  subFreqL: string; subDayL: string; subMonthL: string; subCatL: string; subSaveBtn: string;
  subMonthly: string; subYearly: string; subNext: string; subDueToday: string;
  subKind: string; subExpense: string; subTransfer: string;
  subPeriods: string; subInstallment: string; subDone: string;
  // reimbursement / refund / mark menu
  setReimburse: string; setReimburseD: string; rbPending: string; rbDone: string; rbNone: string;
  rbMark: string; rbUnmark: string; rbConfirm: string;
  markMenu: string; markRefund: string; markEdit: string;
  refundAmt: string; refundDone: string; refundFull: string;
  // templates
  setTemplates: string; setTemplatesD: string; tmplSaveBtn: string; tmplSaved: string; tmplEmpty: string;
  // tags & ledgers
  setTags: string; setTagsD: string; tagAdd: string; tagNormal: string; tagLedger: string;
  tagName: string; tagPick: string; ledgerPick: string; ledgerAll: string;
  // currency
  setCurrency: string; setCurrencyD: string; curMain: string; curRate: string; curAddRate: string;
  curUpdate: string; curUpdating: string; curUpdated: string; curUpdateFail: string; curConverted: string;
  // subcategories
  subcatAdd: string; subcatName: string; subcatMgr: string; subcatHint: string;
  // review
  setReview: string; setReviewD: string; reviewSaved: string; reviewActiveDays: string; reviewShare: string;
  // app lock
  setLock: string; setLockD: string; lockEnable: string; lockDisable: string; lockTitle: string; lockUnlock: string; lockPrompt: string;
  // cloud sync / account
  setSync: string; setSyncD: string; syncNotConfigured: string; syncEmail: string; syncSendCode: string;
  syncCode: string; syncVerify: string; syncSignedInAs: string; syncSignOut: string; syncCodeSent: string; syncFailed: string;
  syncSynced: string; syncSyncing: string; syncError: string;
  // export + reminder
  exportCsv: string; exportBackup: string; exportDone: string;
  remindTitle: string; remindDesc: string; remindOff: string; remindBody: string;
}

export const I18N: Record<Lang, Strings> = {
  zh: {
    title: '大红花记账', sub: 'RED BLOSSOM', net: '本月攒下的 · SAVED', exp: '花掉', inc: '进账',
    xfer: '转账', xferFrom: '转出账户', xferTo: '转入账户', xferFee: '手续费', xferDiscount: '优惠',
    xferNeedAccts: '转账需要至少两个账户，先去设置里添加', xferLabel: '转账',
    list: '明细', cal: '日历', stats: '统计', wall: '集花墙',
    note: '备注（可选）', save: '贴朵花', del: '删除这笔', empty: '还没贴花，点下面那朵开始吧',
    today: '今天', yesterday: '昨天', langBtn: 'EN', newCat: '新建', amountPh: '0',
    toastBloom: '贴上一朵花 🌺', toastStreak: '已连续 %d 天！',
    importOk: '导入成功 🌺', importFail: '文件不对，导入失败', comingSoon: '即将上线 🌱',
    budgetTitle: '本月预算', budgetNone: '还没设预算，去设置里设一个',
    budgetSpentLeft: '已花 %s，还剩 %s', budgetOver: '超了 %s，下月再争取小红花',
    stToday: '今日花掉', stAvg: '日均', stTop: '最大单笔', stCount: '贴花数',
    byCat: '花在哪儿了', trend: '近6月趋势',
    cmpTitle: '本月 vs 上月同期', cmpThis: '本月', cmpLast: '上月同期',
    cmpUp: '比上月同期多 %s', cmpDown: '比上月同期少 %s', cmpSame: '和上月同期差不多',
    calHint: '每朵花代表当天记的一笔，数字是当日花掉',
    wallTitle: '本月集花墙', wallSub: '每记一笔，贴一朵花。集满整版，这个月你就赢了。',
    flowersUnit: '朵', streakLabel: '连续贴花', daysUnit: '天',
    setTitle: '设置', setSub: '把大红花调成你的样子',
    setBudget: '每月预算', setBudgetD: '花盆水位会跟着预算走',
    setCycle: '记账周期起始日', setCycleD: '几号开始算新的一月（默认1号）',
    setTheme: '花色主题', setThemeD: '换个心情', darkTitle: '深色模式', darkDesc: '夜里记账更护眼',
    langTitle: '语言', langDesc: '中文 / English', dataTitle: '从备份导入', dataDesc: '读取旧版「备份全部数据」的 JSON',
    importBtn: '选择备份文件', back: '返回',
    setAccounts: '账户', setAccountsD: '现金、信用卡、微信…分开记', acctAdd: '＋ 添加账户',
    acctName: '账户名（如 微信）', acctBal: '初始余额', acctSaveBtn: '保存账户', acctBalance: '余额', acctDefault: '默认',
    acctKind: '类型', acctKindCash: '现金', acctKindCredit: '信用', acctKindPrepaid: '储值', acctOwed: '欠款',
    setAssets: '资产净值', setAssetsD: '资产、负债、净资产一目了然', assetNet: '净资产', assetTotal: '资产', assetDebt: '负债',
    assetAdd: '＋ 添加资产/负债', assetAsset: '资产', assetLiab: '负债', assetName: '名称（如 招商信用卡）', assetVal: '金额', assetSave: '保存',
    setLoans: '借入借出', setLoansD: '谁欠我、我欠谁，还款进度', loanLend: '借出（别人欠我）', loanBorrow: '借入（我欠别人）',
    loanWho: '对方（如 张三）', loanAmt: '金额', loanSave: '保存', loanAdd: '＋ 新增借贷', loanOwedMe: '待收回', loanIOwe: '待还款',
    loanRemain: '剩余 %s', loanCleared: '已结清 🌺', loanRepay: '记一笔还款', repayAmt: '还款金额', loanProgress: '还款进度',
    searchPh: '搜分类、备注、金额…', noResult: '没找到相关记录', newCatTitle: '新建分类', catNamePh: '分类名称', catCreate: '创建分类',
    setSubs: '订阅 / 分期', setSubsD: '订阅、分期、循环转账，到期自动记账', subAdd: '＋ 添加订阅', subName: '名称（如 Netflix）', subAmtL: '每期金额',
    subFreqL: '周期', subDayL: '每期几号扣费', subMonthL: '每年几月扣费', subCatL: '分类', subSaveBtn: '保存订阅',
    subMonthly: '每月', subYearly: '每年', subNext: '下次 %s', subDueToday: '今天扣费 · 已自动记账',
    subKind: '类型', subExpense: '支出', subTransfer: '转账',
    subPeriods: '分期数（可选，留空为长期订阅）', subInstallment: '已扣 %s/%s 期', subDone: '已完成 🌺',
    setReimburse: '报销', setReimburseD: '待报销、已报销一笔不漏', rbPending: '待报销', rbDone: '已报销', rbNone: '还没有待报销的账单。长按某笔可标记',
    rbMark: '标为待报销', rbUnmark: '取消报销', rbConfirm: '确认已报销',
    markMenu: '标记', markRefund: '退款', markEdit: '编辑',
    refundAmt: '退款金额', refundDone: '已退 %s', refundFull: '已全额退款',
    setTemplates: '快捷模板', setTemplatesD: '常记的存成模板，一键贴花', tmplSaveBtn: '存为模板', tmplSaved: '已存为模板 🌺', tmplEmpty: '还没有模板，记一笔后存起来',
    setTags: '标签管理', setTagsD: '给账单贴标签，灵活统计', tagAdd: '＋ 新建标签', tagNormal: '普通标签', tagLedger: '账本',
    tagName: '标签名（如 旅行）', tagPick: '标签', ledgerPick: '账本', ledgerAll: '全部账本',
    setCurrency: '多币种', setCurrencyD: '留学/旅行，自动换算汇率', curMain: '主币种', curRate: '汇率（1 外币 = ? 主币）', curAddRate: '＋ 添加币种',
    curUpdate: '联网更新汇率', curUpdating: '更新中…', curUpdated: '汇率已更新 🌺', curUpdateFail: '更新失败，可手动填', curConverted: '≈ %s',
    subcatAdd: '＋ 子分类', subcatName: '子分类名（如 早餐）', subcatMgr: '管理子分类', subcatHint: '长按分类管理子分类',
    setReview: '本月回顾', setReviewD: '你的花园小结', reviewSaved: '这个月攒下', reviewActiveDays: '记账天数', reviewShare: '分享战报',
    setLock: '密码锁', setLockD: '打开 App 需验证身份（指纹/面容/设备密码）', lockEnable: '开启', lockDisable: '关闭', lockTitle: '大红花已锁定', lockUnlock: '解锁', lockPrompt: '验证身份解锁大红花记账',
    setSync: '云同步 / 账号', setSyncD: '登录后多设备实时同步', syncNotConfigured: '未配置云后端。按 SYNC_SETUP.md 创建 Supabase 项目并填入密钥后即可启用。', syncEmail: '邮箱', syncSendCode: '发送验证码', syncCode: '验证码（查收邮箱）', syncVerify: '登录', syncSignedInAs: '已登录', syncSignOut: '退出登录', syncCodeSent: '验证码已发送 🌺', syncFailed: '出错了，请重试',
    syncSynced: '已同步 🌺', syncSyncing: '同步中…', syncError: '同步出错，稍后自动重试',
    exportCsv: '导出 CSV', exportBackup: '导出备份 (JSON)', exportDone: '已导出 🌺',
    remindTitle: '每日提醒', remindDesc: '到点提醒你记一笔', remindOff: '关闭', remindBody: '今天还没贴花，来记一笔吧 🌺',
  },
  en: {
    title: 'Red Blossom', sub: 'RED BLOSSOM', net: 'SAVED THIS MONTH', exp: 'Spent', inc: 'In',
    xfer: 'Transfer', xferFrom: 'From', xferTo: 'To', xferFee: 'Fee', xferDiscount: 'Bonus',
    xferNeedAccts: 'Transfers need at least two accounts — add one in Settings', xferLabel: 'Transfer',
    list: 'Activity', cal: 'Calendar', stats: 'Stats', wall: 'Garden',
    note: 'Note (optional)', save: 'Add a flower', del: 'Delete entry', empty: 'No flowers yet — tap the bloom below to start',
    today: 'Today', yesterday: 'Yesterday', langBtn: '中', newCat: 'New', amountPh: '0',
    toastBloom: 'A flower bloomed 🌺', toastStreak: '%d-day streak!',
    importOk: 'Imported 🌺', importFail: 'Bad file — import failed', comingSoon: 'Coming soon 🌱',
    budgetTitle: 'Monthly budget', budgetNone: 'No budget yet — set one in Settings',
    budgetSpentLeft: '%s spent, %s left', budgetOver: '%s over — aim for more flowers next month',
    stToday: 'Today', stAvg: 'Daily avg', stTop: 'Largest', stCount: 'Flowers',
    byCat: 'Where it goes', trend: '6-month trend',
    cmpTitle: 'This month vs last (so far)', cmpThis: 'This month', cmpLast: 'Last month',
    cmpUp: '%s more than last month so far', cmpDown: '%s less than last month so far', cmpSame: 'about the same as last month',
    calHint: 'Each flower = one entry; number = spent that day',
    wallTitle: "This month's garden", wallSub: 'One entry, one flower. Fill the garden to win the month.',
    flowersUnit: '', streakLabel: 'Day streak', daysUnit: '',
    setTitle: 'Settings', setSub: 'Make Red Blossom yours',
    setBudget: 'Monthly budget', setBudgetD: 'The pot fills against this',
    setCycle: 'Cycle start day', setCycleD: 'Which day a new month begins (default 1st)',
    setTheme: 'Flower theme', setThemeD: 'Switch the mood', darkTitle: 'Dark mode', darkDesc: 'Easier on the eyes at night',
    langTitle: 'Language', langDesc: '中文 / English', dataTitle: 'Import from backup', dataDesc: "Read the old app's full-backup JSON",
    importBtn: 'Choose backup file', back: 'Back',
    setAccounts: 'Accounts', setAccountsD: 'Cash, card, wallet… kept apart', acctAdd: '＋ Add account',
    acctName: 'Account name (e.g. Card)', acctBal: 'Starting balance', acctSaveBtn: 'Save account', acctBalance: 'Balance', acctDefault: 'Default',
    acctKind: 'Type', acctKindCash: 'Cash', acctKindCredit: 'Credit', acctKindPrepaid: 'Prepaid', acctOwed: 'Owed',
    setAssets: 'Net worth', setAssetsD: 'Assets, liabilities, net worth at a glance', assetNet: 'Net worth', assetTotal: 'Assets', assetDebt: 'Liabilities',
    assetAdd: '＋ Add asset/liability', assetAsset: 'Asset', assetLiab: 'Liability', assetName: 'Name (e.g. Credit card)', assetVal: 'Amount', assetSave: 'Save',
    setLoans: 'Loans', setLoansD: 'Who owes whom, with repayment', loanLend: 'Lent (they owe me)', loanBorrow: 'Borrowed (I owe them)',
    loanWho: 'Person (e.g. Alex)', loanAmt: 'Amount', loanSave: 'Save', loanAdd: '＋ New loan', loanOwedMe: 'Owed to me', loanIOwe: 'I owe',
    loanRemain: '%s left', loanCleared: 'Settled 🌺', loanRepay: 'Log a repayment', repayAmt: 'Repayment amount', loanProgress: 'Repayment',
    searchPh: 'Search category, note, amount…', noResult: 'No matching entries', newCatTitle: 'New category', catNamePh: 'Category name', catCreate: 'Create',
    setSubs: 'Subscriptions', setSubsD: 'Subscriptions, installments & transfers — auto-logged', subAdd: '＋ Add subscription', subName: 'Name (e.g. Netflix)', subAmtL: 'Amount per cycle',
    subFreqL: 'Frequency', subDayL: 'Charge day', subMonthL: 'Charge month', subCatL: 'Category', subSaveBtn: 'Save subscription',
    subMonthly: 'Monthly', subYearly: 'Yearly', subNext: 'Next %s', subDueToday: 'Due today · auto-logged',
    subKind: 'Type', subExpense: 'Expense', subTransfer: 'Transfer',
    subPeriods: 'Installments (optional; blank = ongoing)', subInstallment: '%s/%s charged', subDone: 'Done 🌺',
    setReimburse: 'Reimbursement', setReimburseD: 'Track pending & done claims', rbPending: 'Pending', rbDone: 'Reimbursed', rbNone: 'No pending claims. Long-press an entry to mark it',
    rbMark: 'Mark pending', rbUnmark: 'Unmark', rbConfirm: 'Mark reimbursed',
    markMenu: 'Mark', markRefund: 'Refund', markEdit: 'Edit',
    refundAmt: 'Refund amount', refundDone: '%s refunded', refundFull: 'Fully refunded',
    setTemplates: 'Quick templates', setTemplatesD: 'Save regulars, log in one tap', tmplSaveBtn: 'Save as template', tmplSaved: 'Saved as template 🌺', tmplEmpty: 'No templates yet — save one after an entry',
    setTags: 'Tags', setTagsD: 'Tag entries for flexible stats', tagAdd: '＋ New tag', tagNormal: 'Tags', tagLedger: 'Ledgers',
    tagName: 'Tag name (e.g. Travel)', tagPick: 'Tags', ledgerPick: 'Ledger', ledgerAll: 'All ledgers',
    setCurrency: 'Currencies', setCurrencyD: 'Auto-convert for study/travel', curMain: 'Base currency', curRate: 'Rate (1 foreign = ? base)', curAddRate: '＋ Add currency',
    curUpdate: 'Update rates online', curUpdating: 'Updating…', curUpdated: 'Rates updated 🌺', curUpdateFail: 'Update failed — set manually', curConverted: '≈ %s',
    subcatAdd: '＋ Subcategory', subcatName: 'Subcategory (e.g. Breakfast)', subcatMgr: 'Manage subcategories', subcatHint: 'Long-press a category to manage',
    setReview: 'Month in review', setReviewD: 'Your garden recap', reviewSaved: 'Saved this month', reviewActiveDays: 'Active days', reviewShare: 'Share recap',
    setLock: 'App lock', setLockD: 'Require auth to open (biometrics / device passcode)', lockEnable: 'Enable', lockDisable: 'Disable', lockTitle: 'Red Blossom is locked', lockUnlock: 'Unlock', lockPrompt: 'Authenticate to open Red Blossom',
    setSync: 'Cloud sync / account', setSyncD: 'Sign in for real-time multi-device sync', syncNotConfigured: 'No cloud backend configured. Follow SYNC_SETUP.md to create a Supabase project and add the keys to enable it.', syncEmail: 'Email', syncSendCode: 'Send code', syncCode: 'Code (check your email)', syncVerify: 'Sign in', syncSignedInAs: 'Signed in', syncSignOut: 'Sign out', syncCodeSent: 'Code sent 🌺', syncFailed: 'Something went wrong — try again',
    syncSynced: 'Synced 🌺', syncSyncing: 'Syncing…', syncError: 'Sync error — retrying',
    exportCsv: 'Export CSV', exportBackup: 'Export backup (JSON)', exportDone: 'Exported 🌺',
    remindTitle: 'Daily reminder', remindDesc: 'A nudge to log an entry', remindOff: 'Off', remindBody: 'No flower yet today — log one 🌺',
  },
};
