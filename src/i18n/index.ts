// i18n — ported subset of v7's I18N, growing per phase.
import zhRecord from './zh/record.json';
import zhBudget from './zh/budget.json';
import zhStats from './zh/stats.json';
import zhSettings from './zh/settings.json';
import zhAccounts from './zh/accounts.json';
import zhSync from './zh/sync.json';

import enRecord from './en/record.json';
import enBudget from './en/budget.json';
import enStats from './en/stats.json';
import enSettings from './en/settings.json';
import enAccounts from './en/accounts.json';
import enSync from './en/sync.json';

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
  delConfirmTitle: string; delConfirmMsg: string; delConfirmBtn: string;
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
  budgetWarn80: string; budgetWarn100: string; budgetWarnCat80: string; budgetWarnCat100: string;
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
  biErrors: string; biErrorRow: string; // %d = row number
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
  acctKind: string; acctKindCash: string; acctKindCredit: string; acctKindPrepaid: string; acctKindFx: string; acctOwed: string;
  acctFxCode: string; acctFxHint: string;
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
  searchPh: string; noResult: string; noResultHint: string; clearFilters: string; newCatTitle: string; catNamePh: string; catCreate: string;
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
  dtReimburse: string; dtRefund: string; dtFromSub: string; dtOrig: string; dtRate: string; dtRateUnknown: string; dtDupe: string;
  // templates
  setTemplates: string; setTemplatesD: string; tmplSaveBtn: string; tmplSaved: string; tmplEmpty: string;
  // tags & ledgers
  setTags: string; setTagsD: string; tagAdd: string; tagNormal: string; tagLedger: string;
  tagName: string; tagPick: string; ledgerPick: string; ledgerAll: string;
  // currency
  setCurrency: string; setCurrencyD: string; curMain: string; curRate: string; curAddRate: string;
  curUpdate: string; curUpdating: string; curUpdated: string; curUpdateFail: string; curConverted: string; rateCached: string;
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
  syncSynced: string; syncSyncing: string; syncError: string; syncOff: string; retrySync: string;
  // export + reminder
  exportCsv: string; exportXlsx: string; exportBackup: string; exportDone: string;
  // backup
  backupCreate: string; backupCreating: string; backupCreated: string; backupRestore: string;
  backupRestoreConfirm: string; backupRestoreDone: string; backupList: string; backupEmpty: string;
  backupAuto: string; backupAutoD: string; backupFreq: string; backupFreqDaily: string;
  backupFreqWeekly: string; backupMax: string; backupMaxD: string;
  backupEncrypt: string; backupEncryptD: string;
  backupPassword: string; backupPasswordPh: string;
  backupPasswordConfirm: string; backupPasswordMismatch: string;
  backupPasswordRequired: string; backupEncryptedTag: string;
  remindTitle: string; remindDesc: string; remindOff: string; remindBody: string;
  weeklyReportTitle: string; weeklyReportDesc: string;
  monthlyReportTitle: string; monthlyReportDesc: string;
  // voice
  voiceTitle: string; voiceListening: string; voiceHint: string;
  // camera
  cameraTitle: string; cameraTake: string; cameraGallery: string; cameraProcessing: string;
  cameraPermission: string; cameraPermissionDesc: string;
  // additional a11y labels
  a11yRemoveRate: string; a11yRemoveImage: string; a11ySelectCurrency: string;
  a11ySwipeEdit: string; a11ySwipeDelete: string;
  a11yPeriodPrev: string; a11yPeriodNext: string;
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
  zh: { ...zhRecord, ...zhBudget, ...zhStats, ...zhSettings, ...zhAccounts, ...zhSync } as Strings,
  en: { ...enRecord, ...enBudget, ...enStats, ...enSettings, ...enAccounts, ...enSync } as Strings,
};

// Count-aware units. Chinese has no plural form; English pluralizes on n !== 1.
export function daysUnit(lang: Lang, n: number): string {
  return lang === 'zh' ? '天' : n === 1 ? 'day' : 'days';
}

export function flowersUnit(lang: Lang, n: number): string {
  return lang === 'zh' ? '朵' : n === 1 ? 'flower' : 'flowers';
}
