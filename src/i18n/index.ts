// i18n — ported subset of v7's I18N, growing per phase.
export type Lang = 'zh' | 'en';

export interface Strings {
  // header / core loop
  title: string; sub: string; net: string; exp: string; inc: string;
  // transfer (转账)
  xfer: string; xferFrom: string; xferTo: string; xferFee: string; xferDiscount: string;
  xferNeedAccts: string; xferLabel: string;
  list: string; cal: string; stats: string; assets: string; me: string;
  // tab hubs (资产 / 我的)
  a11yCalToggle: string; a11yListToggle: string;
  asAccounts: string; asManage: string; asManageD: string; asOther: string; asOtherD: string;
  asEmpty: string;
  meGroupTools: string; meGroupData: string; meGroupMore: string;
  meStreakLine: string; // %f = flowers this cycle · %d = streak, both count-aware
  meAbout: string; meAboutD: string;
  note: string; save: string; del: string; empty: string;
  deleted: string; undo: string;
  today: string; yesterday: string; langBtn: string; newCat: string; amountPh: string;
  dayBefore: string; pickDate: string; saveNext: string; savedNext: string; // savedNext has %s
  a11yHideAmts: string; a11yShowAmts: string; calAddHere: string;
  toastBloom: string; toastStreak: string; // toastStreak has %d
  importOk: string; importFail: string; comingSoon: string;
  cancel: string; importSkipped: string;
  curBaseSwitch: string; curBaseConfirm: string; curBaseDone: string; curBaseNoRate: string;
  errAmount: string; errXferTo: string; errXferSame: string; errNoRate: string;
  // ai quick-entry
  aiPlaceholder: string; aiParsing: string; aiFailed: string; aiUnconfigured: string;
  aiPrivacyTitle: string; aiPrivacyDesc: string; aiShareOn: string; aiShareOff: string;
  // accessibility labels (screen readers)
  a11yMonthPrev: string; a11yMonthNext: string; a11yAdd: string; a11yClearSearch: string; a11ySearch: string;
  a11yLang: string; a11yAI: string; a11yKeyBack: string; a11yKeyClear: string; a11yKeyEq: string;
  // budget + insight
  budgetTitle: string; budgetNone: string; budgetSpentLeft: string; budgetOver: string; // %s
  budgetDailyLabel: string; budgetDailyLeft: string; budgetDailyOver: string; // %s
  setBudgetNav: string; setBudgetNavD: string;
  budgetScreenTitle: string; budgetScreenSub: string;
  budgetMonthlySec: string; budgetDailySec: string; budgetCatSec: string; budgetCatSecD: string;
  budgetDailyD: string; budgetCatHint: string;
  setBudgetWeekly: string; setBudgetWeeklyD: string;
  budgetWeeklyLabel: string; budgetWeeklyLeft: string; budgetWeeklyOver: string; // %s
  insightDailyOver: string; // %s
  // stats
  stToday: string; stAvg: string; stTop: string; stCount: string;
  stTopSpend: string; stByWeekday: string;
  stByTime: string; // 记账时段 (by time of day)
  todDawn: string; todEarlyMorning: string; todMorning: string; todNoon: string; todAfternoon: string; todDusk: string; todNight: string;
  byCat: string; trend: string; trendGeneric: string;
  pDay: string; pWeek: string; pMonth: string; pHalf: string; pYear: string;
  ovExp: string; ovInc: string; ovBalance: string; ovCount: string;
  cmpTitle: string; cmpThis: string; cmpLast: string; cmpUp: string; cmpDown: string; cmpSame: string;
  // calendar
  calHint: string;
  // garden
  streakLabel: string;
  // settings
  setTitle: string; setSub: string;
  setGroupBudget: string; setGroupLook: string; setGroupWallet: string; setGroupTools: string; setGroupData: string; setGroupOther: string;
  setGroupPref: string; setGroupSafety: string;
  statsMore: string; statsMoreD: string; trend7d: string;
  setBudget: string; setBudgetD: string; setCycle: string; setCycleD: string;
  setTheme: string; setThemeD: string; darkTitle: string; darkDesc: string;
  langTitle: string; langDesc: string; dataTitle: string; dataDesc: string; importBtn: string;
  back: string;
  // bill import (支付宝 / 微信 CSV → entries)
  billImportNav: string; billImportNavD: string;
  billImportTitle: string; billImportSub: string;
  biPick: string; biParsing: string; biHint: string; biNoHeader: string;
  biSourceLabel: string; biAlipay: string; biWechat: string; biGeneric: string;
  biPreview: string; biFresh: string; biDup: string; biSkip: string; // %d
  biConfirm: string; biImported: string; biNothing: string; biMore: string; // %d
  // auto capture (Android payment notifications → entries)
  capNav: string; capNavD: string; capTitle: string; capSub: string;
  capUnsupported: string; capIntro: string;
  capStepGrant: string; capStepGrantD: string; capGrant: string; capGranted: string;
  capStepOn: string; capStepOnD: string; capOn: string; capOff: string;
  capStepAlive: string; capStepAliveD: string;
  capPending: string; capPendingEmpty: string; capConfirm: string; capDismiss: string;
  capUnparsed: string; capUnparsedD: string; capClear: string;
  capAcctNote: string;
  // accounts
  setAccounts: string; setAccountsD: string; acctAdd: string;
  acctName: string; acctBal: string; acctSaveBtn: string; acctBalance: string; acctDefault: string;
  acctKind: string; acctKindCash: string; acctKindCredit: string; acctKindPrepaid: string; acctOwed: string;
  acctTxTitle: string;
  archive: string; unarchive: string; archivedSection: string; archivedHint: string;
  // credit-card statement cycle (信用卡账单周期)
  acctStmtDay: string; acctDueDay: string;
  stmtBilledDue: string; stmtUnbilled: string; stmtOverpay: string; stmtDueOn: string;
  stmtDaysLeft: string; stmtDueToday: string; stmtOverdue: string; // %d
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
  // entry detail (read-only view)
  dtTitle: string; dtType: string; dtTime: string; dtAccount: string; dtSubcat: string;
  dtReimburse: string; dtRefund: string; dtFromSub: string; dtOrig: string; dtDupe: string;
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
  lockRetry: string; lockFailed: string; lockUnavailable: string;
  // cloud sync / account
  setSync: string; setSyncD: string; syncNotConfigured: string; syncEmail: string; syncSendCode: string;
  syncCode: string; syncVerify: string; syncSignedInAs: string; syncSignOut: string; syncCodeSent: string; syncFailed: string;
  syncSynced: string; syncSyncing: string; syncError: string;
  // export + reminder
  exportCsv: string; exportBackup: string; exportDone: string;
  // backup
  backupCreate: string; backupCreating: string; backupCreated: string; backupRestore: string;
  backupRestoreConfirm: string; backupRestoreDone: string; backupList: string; backupEmpty: string;
  backupAuto: string; backupAutoD: string; backupFreq: string; backupFreqDaily: string;
  backupFreqWeekly: string; backupMax: string; backupMaxD: string;
  remindTitle: string; remindDesc: string; remindOff: string; remindBody: string;
  // voice
  voiceTitle: string; voiceListening: string; voiceHint: string;
  // camera
  cameraTitle: string; cameraTake: string; cameraGallery: string; cameraProcessing: string;
  cameraPermission: string; cameraPermissionDesc: string;
  // report
  reportTitle: string; reportGenerate: string; reportGenerating: string; reportShare: string;
  reportTotalExp: string; reportTotalInc: string; reportBalance: string; reportByCategory: string;
  reportTransactions: string;
  // insights
  insightsTitle: string; insightsSub: string;
  // themes
  themeOcean: string; themeForest: string; themeSunset: string;
}

export const I18N: Record<Lang, Strings> = {
  zh: {
    title: '大红花记账', sub: 'RED BLOSSOM', net: '本月攒下的 · SAVED', exp: '花掉', inc: '进账',
    xfer: '转账', xferFrom: '转出账户', xferTo: '转入账户', xferFee: '手续费', xferDiscount: '优惠',
    xferNeedAccts: '转账需要至少两个账户，先去设置里添加', xferLabel: '转账',
    list: '明细', cal: '日历', stats: '统计', assets: '资产', me: '我的',
    a11yCalToggle: '切换到日历', a11yListToggle: '切换到明细',
    asAccounts: '我的账户', asManage: '管理账户', asManageD: '新增、归档、信用卡账单日',
    asOther: '其他资产 / 负债', asOtherD: '房产、车、公积金…手动登记',
    asEmpty: '还没有账户，先加一个钱包吧',
    meGroupTools: '记账工具', meGroupData: '数据与同步', meGroupMore: '更多',
    meStreakLine: '本月贴了 %f · 连续 %d',
    meAbout: '关于大红花', meAboutD: '版本、开源许可与致谢',
    note: '备注（可选）', save: '贴朵花', del: '删除这笔', empty: '还没贴花，点下面那朵开始吧',
    deleted: '已删除一笔', undo: '撤销',
    today: '今天', yesterday: '昨天', langBtn: 'EN', newCat: '新建', amountPh: '0',
    dayBefore: '前天', pickDate: '选择日期', saveNext: '再记', savedNext: '已记 %s，继续 🌺',
    a11yHideAmts: '隐藏金额', a11yShowAmts: '显示金额', calAddHere: '补记这天',
    toastBloom: '贴上一朵花 🌺', toastStreak: '已连续 %d 天！',
    importOk: '导入成功 🌺', importFail: '文件不对，导入失败', comingSoon: '即将上线 🌱',
    cancel: '取消', importSkipped: '跳过 %d 条格式错误',
    curBaseSwitch: '切换主货币', curBaseConfirm: '所有金额将按当前汇率换算成 %s，确定？',
    curBaseDone: '已换算 🌺', curBaseNoRate: '请先设置 %s 的汇率',
    errAmount: '先填个金额吧', errXferTo: '选一个转入账户', errXferSame: '转入和转出不能是同一个账户',
    errNoRate: '请先设置 %s 的汇率',
    aiPlaceholder: '说一句，比如「午饭35」', aiParsing: '…', aiFailed: 'AI 解析失败，手动记吧', aiUnconfigured: '还没配置 AI，去 AI_SETUP 看看',
    aiPrivacyTitle: '向 AI 发送分类', aiPrivacyDesc: '关闭后只发送内置分类，自定义分类名不外发', aiShareOn: '发送', aiShareOff: '不发送',
    a11yMonthPrev: '上一个月', a11yMonthNext: '下一个月', a11yAdd: '记一笔', a11yClearSearch: '清除搜索', a11ySearch: '搜索',
    a11yLang: '切换语言', a11yAI: 'AI 智能记账', a11yKeyBack: '退格', a11yKeyClear: '清空', a11yKeyEq: '等于',
    budgetTitle: '本月预算', budgetNone: '还没设预算，去设置里设一个',
    budgetSpentLeft: '已花 %s，还剩 %s', budgetOver: '超了 %s，下月再争取小红花',
    budgetDailyLabel: '今日预算', budgetDailyLeft: '今天还能花 %s', budgetDailyOver: '今天超了 %s',
    setBudgetNav: '预算', setBudgetNavD: '每月 / 每日 / 分类，三档预算',
    budgetScreenTitle: '预算', budgetScreenSub: '给花盆设个水位线',
    budgetMonthlySec: '每月预算', budgetDailySec: '每日预算', budgetCatSec: '分类预算', budgetCatSecD: '给单个分类单独设上限',
    budgetDailyD: '每天的花销上限', budgetCatHint: '留空不限',
    setBudgetWeekly: '每周预算', setBudgetWeeklyD: '按周控制花销',
    budgetWeeklyLabel: '本周预算', budgetWeeklyLeft: '本周还能花 %s', budgetWeeklyOver: '本周超了 %s',
    insightDailyOver: '今天花超了，超出 %s。',
    stToday: '今日花掉', stAvg: '日均', stTop: '最大单笔', stCount: '贴花数',
    stTopSpend: '最大支出 Top', stByWeekday: '按星期',
    stByTime: '按时段',
    todDawn: '凌晨', todEarlyMorning: '清晨', todMorning: '上午', todNoon: '中午', todAfternoon: '下午', todDusk: '傍晚', todNight: '晚上',
    byCat: '花在哪儿了', trend: '近6月趋势', trendGeneric: '近6期趋势',
    pDay: '日', pWeek: '周', pMonth: '月', pHalf: '半年', pYear: '年',
    ovExp: '支出', ovInc: '收入', ovBalance: '结余', ovCount: '笔数',
    cmpTitle: '本月 vs 上月同期', cmpThis: '本月', cmpLast: '上月同期',
    cmpUp: '比上月同期多 %s', cmpDown: '比上月同期少 %s', cmpSame: '和上月同期差不多',
    calHint: '每朵花代表当天记的一笔，数字是当日花掉',
    streakLabel: '连续贴花',
    setTitle: '设置', setSub: '把大红花调成你的样子',
    setGroupBudget: '预算与周期', setGroupLook: '个性化', setGroupWallet: '钱包与资产', setGroupTools: '记账工具', setGroupData: '数据与备份', setGroupOther: '其他',
    setGroupPref: '记账偏好', setGroupSafety: '安全与隐私',
    statsMore: '更多分析', statsMoreD: '洞察、报表与月度回顾', trend7d: '近 7 天走势',
    setBudget: '每月预算', setBudgetD: '花盆水位会跟着预算走',
    setCycle: '记账周期起始日', setCycleD: '几号开始算新的一月（默认1号）',
    setTheme: '花色主题', setThemeD: '换个心情', darkTitle: '深色模式', darkDesc: '夜里记账更护眼',
    langTitle: '语言', langDesc: '中文 / English', dataTitle: '导出与导入', dataDesc: '导出表格或整份备份；也可读取旧版「备份全部数据」的 JSON',
    importBtn: '选择备份文件', back: '返回',
    billImportNav: '导入账单', billImportNavD: '从支付宝 / 微信 CSV 导入',
    billImportTitle: '导入账单', billImportSub: '支持支付宝、微信导出的 CSV 账单',
    biPick: '选择账单文件', biParsing: '解析中…',
    biHint: '在支付宝或微信里导出「交易明细」CSV，再到这里选择文件。会自动识别列、匹配分类，并跳过已存在的账单。',
    biNoHeader: '未找到账单表头，请确认这是支付宝或微信导出的 CSV 文件',
    biSourceLabel: '来源', biAlipay: '支付宝', biWechat: '微信', biGeneric: '通用 CSV',
    biPreview: '账单预览', biFresh: '可导入', biDup: '已存在 · 跳过', biSkip: '已忽略',
    biConfirm: '导入', biImported: '已导入', biNothing: '没有可导入的新账单', biMore: '等',
    capNav: '自动记账', capNavD: '读取支付通知，自动记一笔',
    capTitle: '自动记账', capSub: '支付宝、微信、银行的支付通知自动入账',
    capUnsupported: '自动记账只在 Android 版可用。iOS 不开放读取其他应用的通知，请用「导入账单」。',
    capIntro: '开启后，收到支付通知会自动记一笔。识别不出商家的会放进「待确认」，点一下即可入账。每月再导一次账单 CSV 可以兜住漏掉的。',
    capStepGrant: '① 开启通知使用权', capStepGrantD: '在系统设置里允许大红花记账读取通知',
    capGrant: '去授权', capGranted: '已授权',
    capStepOn: '② 打开自动记账', capStepOnD: '关闭后不再读取任何通知',
    capOn: '已开启', capOff: '已关闭',
    capStepAlive: '③ 让它活着（小米必做）',
    capStepAliveD: 'HyperOS 会杀掉后台服务，服务被杀后就静默停止记账。设置 → 应用设置 → 应用管理 → 大红花记账：开启「自动启动」，把「省电策略」改为「无限制」；再从最近任务界面下拉锁定本应用。',
    capPending: '待确认', capPendingEmpty: '没有待确认的记录',
    capConfirm: '记一笔', capDismiss: '忽略',
    capUnparsed: '没认出来的通知', capUnparsedD: '这些通知来自已监听的应用，但没解析出金额。留在这里是为了让识别规则能照着真实文案改。',
    capClear: '清空',
    capAcctNote: '通知里读不到账户和账本，自动记录的这笔会留空，可以在明细里补。',
    setAccounts: '账户', setAccountsD: '现金、信用卡、微信…分开记', acctAdd: '＋ 添加账户',
    acctName: '账户名（如 微信）', acctBal: '初始余额', acctSaveBtn: '保存账户', acctBalance: '余额', acctDefault: '默认',
    acctKind: '类型', acctKindCash: '现金', acctKindCredit: '信用', acctKindPrepaid: '储值', acctOwed: '欠款',
    acctTxTitle: '账户流水',
    archive: '归档', unarchive: '恢复', archivedSection: '已归档', archivedHint: '不出现在记账选择里，历史与余额保留',
    acctStmtDay: '出账日', acctDueDay: '还款日',
    stmtBilledDue: '本期待还', stmtUnbilled: '未出账', stmtOverpay: '溢缴款', stmtDueOn: '还款日',
    stmtDaysLeft: '%d 天后', stmtDueToday: '今天', stmtOverdue: '逾期 %d 天',
    setAssets: '资产净值', setAssetsD: '资产、负债、净资产一目了然', assetNet: '净资产', assetTotal: '资产', assetDebt: '负债',
    assetAdd: '＋ 添加资产/负债', assetAsset: '资产', assetLiab: '负债', assetName: '名称（如 招商信用卡）', assetVal: '金额', assetSave: '保存',
    setLoans: '借入借出', setLoansD: '谁欠我、我欠谁，还款进度', loanLend: '借出（别人欠我）', loanBorrow: '借入（我欠别人）',
    loanWho: '对方（如 张三）', loanAmt: '金额', loanSave: '保存', loanAdd: '＋ 新增借贷', loanOwedMe: '待收回', loanIOwe: '待还款',
    loanRemain: '剩余 %s', loanCleared: '已结清 🌺', loanRepay: '记一笔还款', repayAmt: '还款金额', loanProgress: '还款进度',
    searchPh: '搜分类、备注、标签，或 >100', noResult: '没找到相关记录', newCatTitle: '新建分类', catNamePh: '分类名称', catCreate: '创建分类',
    setSubs: '订阅 / 分期', setSubsD: '订阅、分期、循环转账，到期自动记账', subAdd: '＋ 添加订阅', subName: '名称（如 Netflix）', subAmtL: '每期金额',
    subFreqL: '周期', subDayL: '每期几号扣费', subMonthL: '每年几月扣费', subCatL: '分类', subSaveBtn: '保存订阅',
    subMonthly: '每月', subYearly: '每年', subNext: '下次 %s', subDueToday: '今天扣费 · 已自动记账',
    subKind: '类型', subExpense: '支出', subTransfer: '转账',
    subPeriods: '分期数（可选，留空为长期订阅）', subInstallment: '已扣 %s/%s 期', subDone: '已完成 🌺',
    setReimburse: '报销', setReimburseD: '待报销、已报销一笔不漏', rbPending: '待报销', rbDone: '已报销', rbNone: '还没有待报销的账单。长按某笔可标记',
    rbMark: '标为待报销', rbUnmark: '取消报销', rbConfirm: '确认已报销',
    markMenu: '标记', markRefund: '退款', markEdit: '编辑',
    refundAmt: '退款金额', refundDone: '已退 %s', refundFull: '已全额退款',
    dtTitle: '账单详情', dtType: '类型', dtTime: '时间', dtAccount: '账户', dtSubcat: '子分类',
    dtReimburse: '报销状态', dtRefund: '退款', dtFromSub: '订阅自动记账', dtOrig: '原始金额', dtDupe: '再记一笔',
    setTemplates: '快捷模板', setTemplatesD: '常记的存成模板，一键贴花', tmplSaveBtn: '存为模板', tmplSaved: '已存为模板 🌺', tmplEmpty: '还没有模板，记一笔后存起来',
    setTags: '标签管理', setTagsD: '给账单贴标签，灵活统计', tagAdd: '＋ 新建标签', tagNormal: '普通标签', tagLedger: '账本',
    tagName: '标签名（如 旅行）', tagPick: '标签', ledgerPick: '账本', ledgerAll: '全部账本',
    setCurrency: '多币种', setCurrencyD: '留学/旅行，自动换算汇率', curMain: '主币种', curRate: '汇率（1 外币 = ? 主币）', curAddRate: '＋ 添加币种',
    curUpdate: '联网更新汇率', curUpdating: '更新中…', curUpdated: '汇率已更新 🌺', curUpdateFail: '更新失败，可手动填', curConverted: '≈ %s',
    subcatAdd: '＋ 子分类', subcatName: '子分类名（如 早餐）', subcatMgr: '管理子分类', subcatHint: '长按分类管理子分类',
    setReview: '本月回顾', setReviewD: '你的花园小结', reviewSaved: '这个月攒下', reviewActiveDays: '记账天数', reviewShare: '分享战报',
    setLock: '密码锁', setLockD: '打开 App 需验证身份（指纹/面容/设备密码）', lockEnable: '开启', lockDisable: '关闭', lockTitle: '大红花已锁定', lockUnlock: '解锁', lockPrompt: '验证身份解锁大红花记账',
    lockRetry: '重试', lockFailed: '验证未通过，再试一次', lockUnavailable: '暂时无法验证，请稍后重试',
    setSync: '云同步 / 账号', setSyncD: '登录后多设备实时同步', syncNotConfigured: '未配置云后端。按 SYNC_SETUP.md 创建 Supabase 项目并填入密钥后即可启用。', syncEmail: '邮箱', syncSendCode: '发送验证码', syncCode: '验证码（查收邮箱）', syncVerify: '登录', syncSignedInAs: '已登录', syncSignOut: '退出登录', syncCodeSent: '验证码已发送 🌺', syncFailed: '出错了，请重试',
    syncSynced: '已同步 🌺', syncSyncing: '同步中…', syncError: '同步出错，稍后自动重试',
    exportCsv: '导出 CSV', exportBackup: '导出备份 (JSON)', exportDone: '已导出 🌺',
    remindTitle: '每日提醒', remindDesc: '到点提醒你记一笔', remindOff: '关闭', remindBody: '今天还没贴花，来记一笔吧 🌺',
    backupCreate: '创建备份', backupCreating: '备份中…', backupCreated: '备份已创建 🌺', backupRestore: '恢复备份',
    backupRestoreConfirm: '恢复会覆盖当前数据，确定？', backupRestoreDone: '已恢复 🌺', backupList: '备份列表', backupEmpty: '还没有备份',
    backupAuto: '自动备份', backupAutoD: '定期备份数据', backupFreq: '备份频率', backupFreqDaily: '每天',
    backupFreqWeekly: '每周', backupMax: '最大备份数', backupMaxD: '超出自动删除最旧的备份',
    voiceTitle: '语音记账', voiceListening: '正在听...', voiceHint: '说出花费，如"午饭35"',
    cameraTitle: '拍照记账', cameraTake: '拍照', cameraGallery: '相册', cameraProcessing: '识别中...',
    cameraPermission: '需要相机权限', cameraPermissionDesc: '请在设置中允许访问相机',
    reportTitle: '月度报告', reportGenerate: '生成报告', reportGenerating: '生成中...', reportShare: '分享报告',
    reportTotalExp: '总支出', reportTotalInc: '总收入', reportBalance: '结余', reportByCategory: '分类统计',
    reportTransactions: '交易明细',
    insightsTitle: 'AI 智能洞察', insightsSub: '基于历史数据的支出预测',
    themeOcean: '海洋', themeForest: '森林', themeSunset: '日落',
  },
  en: {
    title: 'Red Blossom', sub: 'RED BLOSSOM', net: 'SAVED THIS MONTH', exp: 'Spent', inc: 'In',
    xfer: 'Transfer', xferFrom: 'From', xferTo: 'To', xferFee: 'Fee', xferDiscount: 'Bonus',
    xferNeedAccts: 'Transfers need at least two accounts — add one in Settings', xferLabel: 'Transfer',
    list: 'Activity', cal: 'Calendar', stats: 'Stats', assets: 'Assets', me: 'Me',
    a11yCalToggle: 'Switch to calendar', a11yListToggle: 'Switch to activity',
    asAccounts: 'My accounts', asManage: 'Manage accounts', asManageD: 'Add, archive, card statement days',
    asOther: 'Other assets / debts', asOtherD: 'Property, car, funds — tracked by hand',
    asEmpty: 'No accounts yet — add your first wallet',
    meGroupTools: 'Tools', meGroupData: 'Data & sync', meGroupMore: 'More',
    meStreakLine: '%f this month · %d in a row',
    meAbout: 'About Red Blossom', meAboutD: 'Version, licences & credits',
    note: 'Note (optional)', save: 'Add a flower', del: 'Delete entry', empty: 'No flowers yet — tap the bloom below to start',
    deleted: 'Entry deleted', undo: 'Undo',
    today: 'Today', yesterday: 'Yesterday', langBtn: '中', newCat: 'New', amountPh: '0',
    dayBefore: '2 days ago', pickDate: 'Pick a date', saveNext: 'Again', savedNext: 'Saved %s — keep going 🌺',
    a11yHideAmts: 'Hide amounts', a11yShowAmts: 'Show amounts', calAddHere: 'Add on this day',
    toastBloom: 'A flower bloomed 🌺', toastStreak: '%d-day streak!',
    importOk: 'Imported 🌺', importFail: 'Bad file — import failed', comingSoon: 'Coming soon 🌱',
    cancel: 'Cancel', importSkipped: '%d malformed rows skipped',
    curBaseSwitch: 'Switch base currency', curBaseConfirm: 'All amounts will be converted to %s at the current rate. Continue?',
    curBaseDone: 'Converted 🌺', curBaseNoRate: 'Set a rate for %s first',
    errAmount: 'Enter an amount first', errXferTo: 'Pick an account to transfer to', errXferSame: 'From and to must differ',
    errNoRate: 'Set a rate for %s first',
    aiPlaceholder: 'Say it, e.g. “lunch 35”', aiParsing: '…', aiFailed: 'AI parse failed — enter it manually', aiUnconfigured: 'AI not configured — see AI_SETUP',
    aiPrivacyTitle: 'Send categories to AI', aiPrivacyDesc: 'Off = only built-in categories are sent; custom names stay on device', aiShareOn: 'On', aiShareOff: 'Off',
    a11yMonthPrev: 'Previous month', a11yMonthNext: 'Next month', a11yAdd: 'Add entry', a11yClearSearch: 'Clear search', a11ySearch: 'Search',
    a11yLang: 'Switch language', a11yAI: 'AI parse', a11yKeyBack: 'Backspace', a11yKeyClear: 'Clear', a11yKeyEq: 'Equals',
    budgetTitle: 'Monthly budget', budgetNone: 'No budget yet — set one in Settings',
    budgetSpentLeft: '%s spent, %s left', budgetOver: '%s over — aim for more flowers next month',
    budgetDailyLabel: 'Today’s budget', budgetDailyLeft: '%s left to spend today', budgetDailyOver: '%s over today',
    setBudgetNav: 'Budgets', setBudgetNavD: 'Monthly / daily / per-category',
    budgetScreenTitle: 'Budgets', budgetScreenSub: 'Set the water line for your pot',
    budgetMonthlySec: 'Monthly budget', budgetDailySec: 'Daily budget', budgetCatSec: 'Category budgets', budgetCatSecD: 'Cap individual categories',
    budgetDailyD: 'A spending cap for each day', budgetCatHint: 'No cap',
    setBudgetWeekly: 'Weekly budget', setBudgetWeeklyD: 'Control spending by week',
    budgetWeeklyLabel: 'This week', budgetWeeklyLeft: '%s left this week', budgetWeeklyOver: '%s over this week',
    insightDailyOver: 'Over today’s budget by %s.',
    stToday: 'Today', stAvg: 'Daily avg', stTop: 'Largest', stCount: 'Flowers',
    stTopSpend: 'Top spending', stByWeekday: 'By weekday',
    stByTime: 'By time of day',
    todDawn: 'Late night', todEarlyMorning: 'Early AM', todMorning: 'Morning', todNoon: 'Noon', todAfternoon: 'Afternoon', todDusk: 'Dusk', todNight: 'Night',
    byCat: 'Where it goes', trend: '6-month trend', trendGeneric: 'Last 6 periods',
    pDay: 'Day', pWeek: 'Week', pMonth: 'Month', pHalf: 'Half', pYear: 'Year',
    ovExp: 'Expense', ovInc: 'Income', ovBalance: 'Balance', ovCount: 'Entries',
    cmpTitle: 'This month vs last (so far)', cmpThis: 'This month', cmpLast: 'Last month',
    cmpUp: '%s more than last month so far', cmpDown: '%s less than last month so far', cmpSame: 'about the same as last month',
    calHint: 'Each flower = one entry; number = spent that day',
    streakLabel: 'Streak',
    setTitle: 'Settings', setSub: 'Make Red Blossom yours',
    setGroupBudget: 'Budget & cycle', setGroupLook: 'Appearance', setGroupWallet: 'Wallet & assets', setGroupTools: 'Tools', setGroupData: 'Data & backup', setGroupOther: 'More',
    setGroupPref: 'Entry preferences', setGroupSafety: 'Security & privacy',
    statsMore: 'More analysis', statsMoreD: 'Insights, reports & recap', trend7d: 'Last 7 days',
    setBudget: 'Monthly budget', setBudgetD: 'The pot fills against this',
    setCycle: 'Cycle start day', setCycleD: 'Which day a new month begins (default 1st)',
    setTheme: 'Flower theme', setThemeD: 'Switch the mood', darkTitle: 'Dark mode', darkDesc: 'Easier on the eyes at night',
    langTitle: 'Language', langDesc: '中文 / English', dataTitle: 'Export & import', dataDesc: "Export a sheet or a full backup — or read the old app's backup JSON",
    importBtn: 'Choose backup file', back: 'Back',
    billImportNav: 'Import bills', billImportNavD: 'From an Alipay / WeChat CSV',
    billImportTitle: 'Import bills', billImportSub: 'CSV exports from Alipay & WeChat Pay',
    biPick: 'Choose a bill file', biParsing: 'Parsing…',
    biHint: 'Export your transaction CSV from Alipay or WeChat, then pick the file here. Columns are auto-detected, categories matched, and existing bills skipped.',
    biNoHeader: "Couldn't find a bill header — make sure this is an Alipay or WeChat CSV export",
    biSourceLabel: 'Source', biAlipay: 'Alipay', biWechat: 'WeChat', biGeneric: 'Generic CSV',
    biPreview: 'Preview', biFresh: 'To import', biDup: 'Already exists · skip', biSkip: 'Ignored',
    biConfirm: 'Import', biImported: 'Imported', biNothing: 'No new bills to import', biMore: 'and more',
    capNav: 'Auto capture', capNavD: 'Log payments from notifications',
    capTitle: 'Auto capture', capSub: 'Turn payment notifications into entries',
    capUnsupported: 'Auto capture is Android-only. iOS does not let apps read other apps’ notifications — use Import bills instead.',
    capIntro: 'Once on, a payment notification becomes an entry by itself. Anything without a recognizable merchant waits under Needs review — one tap to log it. A monthly CSV import still catches whatever slipped through.',
    capStepGrant: '① Grant notification access', capStepGrantD: 'Allow Red Blossom to read notifications in system settings',
    capGrant: 'Grant', capGranted: 'Granted',
    capStepOn: '② Turn auto capture on', capStepOnD: 'Nothing is read while this is off',
    capOn: 'On', capOff: 'Off',
    capStepAlive: '③ Keep it alive',
    capStepAliveD: 'Aggressive battery managers (notably MIUI/HyperOS) unbind background services, and capture stops silently. Allow autostart for Red Blossom and set its battery policy to unrestricted, then lock it in the recents screen.',
    capPending: 'Needs review', capPendingEmpty: 'Nothing waiting',
    capConfirm: 'Log it', capDismiss: 'Ignore',
    capUnparsed: 'Not recognized', capUnparsedD: 'These came from a watched app but no amount could be read. They stay here so the rules can be tuned against real wording.',
    capClear: 'Clear',
    capAcctNote: 'A notification says nothing about the account or ledger, so captured entries leave those blank — fill them in from the list.',
    setAccounts: 'Accounts', setAccountsD: 'Cash, card, wallet… kept apart', acctAdd: '＋ Add account',
    acctName: 'Account name (e.g. Card)', acctBal: 'Starting balance', acctSaveBtn: 'Save account', acctBalance: 'Balance', acctDefault: 'Default',
    acctKind: 'Type', acctKindCash: 'Cash', acctKindCredit: 'Credit', acctKindPrepaid: 'Prepaid', acctOwed: 'Owed',
    acctTxTitle: 'Transactions',
    archive: 'Archive', unarchive: 'Restore', archivedSection: 'Archived', archivedHint: 'Hidden from entry pickers; history & balance kept',
    acctStmtDay: 'Statement day', acctDueDay: 'Due day',
    stmtBilledDue: 'Amount due', stmtUnbilled: 'Unbilled', stmtOverpay: 'Overpaid', stmtDueOn: 'Due',
    stmtDaysLeft: 'in %dd', stmtDueToday: 'today', stmtOverdue: '%dd overdue',
    setAssets: 'Net worth', setAssetsD: 'Assets, liabilities, net worth at a glance', assetNet: 'Net worth', assetTotal: 'Assets', assetDebt: 'Liabilities',
    assetAdd: '＋ Add asset/liability', assetAsset: 'Asset', assetLiab: 'Liability', assetName: 'Name (e.g. Credit card)', assetVal: 'Amount', assetSave: 'Save',
    setLoans: 'Loans', setLoansD: 'Who owes whom, with repayment', loanLend: 'Lent (they owe me)', loanBorrow: 'Borrowed (I owe them)',
    loanWho: 'Person (e.g. Alex)', loanAmt: 'Amount', loanSave: 'Save', loanAdd: '＋ New loan', loanOwedMe: 'Owed to me', loanIOwe: 'I owe',
    loanRemain: '%s left', loanCleared: 'Settled 🌺', loanRepay: 'Log a repayment', repayAmt: 'Repayment amount', loanProgress: 'Repayment',
    searchPh: 'Search category, note, tag, or >100', noResult: 'No matching entries', newCatTitle: 'New category', catNamePh: 'Category name', catCreate: 'Create',
    setSubs: 'Subscriptions', setSubsD: 'Subscriptions, installments & transfers — auto-logged', subAdd: '＋ Add subscription', subName: 'Name (e.g. Netflix)', subAmtL: 'Amount per cycle',
    subFreqL: 'Frequency', subDayL: 'Charge day', subMonthL: 'Charge month', subCatL: 'Category', subSaveBtn: 'Save subscription',
    subMonthly: 'Monthly', subYearly: 'Yearly', subNext: 'Next %s', subDueToday: 'Due today · auto-logged',
    subKind: 'Type', subExpense: 'Expense', subTransfer: 'Transfer',
    subPeriods: 'Installments (optional; blank = ongoing)', subInstallment: '%s/%s charged', subDone: 'Done 🌺',
    setReimburse: 'Reimbursement', setReimburseD: 'Track pending & done claims', rbPending: 'Pending', rbDone: 'Reimbursed', rbNone: 'No pending claims. Long-press an entry to mark it',
    rbMark: 'Mark pending', rbUnmark: 'Unmark', rbConfirm: 'Mark reimbursed',
    markMenu: 'Mark', markRefund: 'Refund', markEdit: 'Edit',
    refundAmt: 'Refund amount', refundDone: '%s refunded', refundFull: 'Fully refunded',
    dtTitle: 'Entry details', dtType: 'Type', dtTime: 'Time', dtAccount: 'Account', dtSubcat: 'Subcategory',
    dtReimburse: 'Reimbursement', dtRefund: 'Refund', dtFromSub: 'From subscription', dtOrig: 'Original', dtDupe: 'Log again',
    setTemplates: 'Quick templates', setTemplatesD: 'Save regulars, log in one tap', tmplSaveBtn: 'Template', tmplSaved: 'Saved as template 🌺', tmplEmpty: 'No templates yet — save one after an entry',
    setTags: 'Tags', setTagsD: 'Tag entries for flexible stats', tagAdd: '＋ New tag', tagNormal: 'Tags', tagLedger: 'Ledgers',
    tagName: 'Tag name (e.g. Travel)', tagPick: 'Tags', ledgerPick: 'Ledger', ledgerAll: 'All ledgers',
    setCurrency: 'Currencies', setCurrencyD: 'Auto-convert for study/travel', curMain: 'Base currency', curRate: 'Rate (1 foreign = ? base)', curAddRate: '＋ Add currency',
    curUpdate: 'Update rates online', curUpdating: 'Updating…', curUpdated: 'Rates updated 🌺', curUpdateFail: 'Update failed — set manually', curConverted: '≈ %s',
    subcatAdd: '＋ Subcategory', subcatName: 'Subcategory (e.g. Breakfast)', subcatMgr: 'Manage subcategories', subcatHint: 'Long-press a category to manage',
    setReview: 'Month in review', setReviewD: 'Your garden recap', reviewSaved: 'Saved this month', reviewActiveDays: 'Active days', reviewShare: 'Share recap',
    setLock: 'App lock', setLockD: 'Require auth to open (biometrics / device passcode)', lockEnable: 'Enable', lockDisable: 'Disable', lockTitle: 'Red Blossom is locked', lockUnlock: 'Unlock', lockPrompt: 'Authenticate to open Red Blossom',
    lockRetry: 'Try again', lockFailed: "That didn't match — try again", lockUnavailable: 'Authentication is unavailable right now',
    setSync: 'Cloud sync / account', setSyncD: 'Sign in for real-time multi-device sync', syncNotConfigured: 'No cloud backend configured. Follow SYNC_SETUP.md to create a Supabase project and add the keys to enable it.', syncEmail: 'Email', syncSendCode: 'Send code', syncCode: 'Code (check your email)', syncVerify: 'Sign in', syncSignedInAs: 'Signed in', syncSignOut: 'Sign out', syncCodeSent: 'Code sent 🌺', syncFailed: 'Something went wrong — try again',
    syncSynced: 'Synced 🌺', syncSyncing: 'Syncing…', syncError: 'Sync error — retrying',
    exportCsv: 'Export CSV', exportBackup: 'Export backup (JSON)', exportDone: 'Exported 🌺',
    remindTitle: 'Daily reminder', remindDesc: 'A nudge to log an entry', remindOff: 'Off', remindBody: 'No flower yet today — log one 🌺',
    backupCreate: 'Create backup', backupCreating: 'Backing up…', backupCreated: 'Backup created 🌺', backupRestore: 'Restore backup',
    backupRestoreConfirm: 'This will overwrite current data. Continue?', backupRestoreDone: 'Restored 🌺', backupList: 'Backups', backupEmpty: 'No backups yet',
    backupAuto: 'Auto backup', backupAutoD: 'Back up data automatically', backupFreq: 'Frequency', backupFreqDaily: 'Daily',
    backupFreqWeekly: 'Weekly', backupMax: 'Max backups', backupMaxD: 'Oldest deleted when exceeded',
    voiceTitle: 'Voice Entry', voiceListening: 'Listening...', voiceHint: 'Say your expense, e.g. "lunch 35"',
    cameraTitle: 'Camera Entry', cameraTake: 'Take Photo', cameraGallery: 'Gallery', cameraProcessing: 'Processing...',
    cameraPermission: 'Camera Permission Required', cameraPermissionDesc: 'Please allow camera access in settings',
    reportTitle: 'Monthly Report', reportGenerate: 'Generate Report', reportGenerating: 'Generating...', reportShare: 'Share Report',
    reportTotalExp: 'Total Expense', reportTotalInc: 'Total Income', reportBalance: 'Balance', reportByCategory: 'By Category',
    reportTransactions: 'Transactions',
    insightsTitle: 'AI Insights', insightsSub: 'Expense forecast based on history',
    themeOcean: 'Ocean', themeForest: 'Forest', themeSunset: 'Sunset',
  },
};

// Count-aware units. Chinese has no plural form; English pluralizes on n !== 1.
export function daysUnit(lang: Lang, n: number): string {
  return lang === 'zh' ? '天' : n === 1 ? 'day' : 'days';
}

export function flowersUnit(lang: Lang, n: number): string {
  return lang === 'zh' ? '朵' : n === 1 ? 'flower' : 'flowers';
}
