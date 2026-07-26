import { useState } from 'react';
import type { IO } from '@/domain/types';

export interface FormState {
  io: IO;
  cat: string;
  amt: string;
  note: string;
  acct: string;
  acctTo: string;
  fee: string;
  discount: string;
  sheetTags: string[];
  ledger: string;
  cur: string;
  subcat: string;
  ts: number | null;
  flash: { msg: string; err?: boolean } | null;
  aiText: string;
  aiBusy: boolean;
  aiMsg: string;
  fetchedRate: number | null;
  rateSource: 'api' | 'cached' | null;
  curDropdown: boolean;
  receiptUri: string | null;
  receiptBusy: boolean;
  attempted: boolean;
  initKey: string | null;
}

export interface FormSetters {
  setIO: React.Dispatch<React.SetStateAction<IO>>;
  setCat: React.Dispatch<React.SetStateAction<string>>;
  setAmt: React.Dispatch<React.SetStateAction<string>>;
  setNote: React.Dispatch<React.SetStateAction<string>>;
  setAcct: React.Dispatch<React.SetStateAction<string>>;
  setAcctTo: React.Dispatch<React.SetStateAction<string>>;
  setFee: React.Dispatch<React.SetStateAction<string>>;
  setDiscount: React.Dispatch<React.SetStateAction<string>>;
  setSheetTags: React.Dispatch<React.SetStateAction<string[]>>;
  setLedger: React.Dispatch<React.SetStateAction<string>>;
  setCur: React.Dispatch<React.SetStateAction<string>>;
  setSubcat: React.Dispatch<React.SetStateAction<string>>;
  setTs: React.Dispatch<React.SetStateAction<number | null>>;
  setFlash: React.Dispatch<React.SetStateAction<{ msg: string; err?: boolean } | null>>;
  setAiText: React.Dispatch<React.SetStateAction<string>>;
  setAiBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setAiMsg: React.Dispatch<React.SetStateAction<string>>;
  setFetchedRate: React.Dispatch<React.SetStateAction<number | null>>;
  setRateSource: React.Dispatch<React.SetStateAction<'api' | 'cached' | null>>;
  setCurDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  setReceiptUri: React.Dispatch<React.SetStateAction<string | null>>;
  setReceiptBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setAttempted: React.Dispatch<React.SetStateAction<boolean>>;
  setInitKey: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useFormState(base: string): FormState & FormSetters {
  const [io, setIO] = useState<IO>('exp');
  const [cat, setCat] = useState('food');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [acct, setAcct] = useState('default');
  const [acctTo, setAcctTo] = useState('');
  const [fee, setFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [sheetTags, setSheetTags] = useState<string[]>([]);
  const [ledger, setLedger] = useState('');
  const [cur, setCur] = useState(base);
  const [subcat, setSubcat] = useState('');
  const [ts, setTs] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ msg: string; err?: boolean } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [fetchedRate, setFetchedRate] = useState<number | null>(null);
  const [rateSource, setRateSource] = useState<'api' | 'cached' | null>(null);
  const [curDropdown, setCurDropdown] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [initKey, setInitKey] = useState<string | null>(null);

  return {
    io, cat, amt, note, acct, acctTo, fee, discount, sheetTags, ledger, cur, subcat,
    ts, flash, aiText, aiBusy, aiMsg, fetchedRate, rateSource, curDropdown,
    receiptUri, receiptBusy, attempted, initKey,
    setIO, setCat, setAmt, setNote, setAcct, setAcctTo, setFee, setDiscount,
    setSheetTags, setLedger, setCur, setSubcat, setTs, setFlash, setAiText,
    setAiBusy, setAiMsg, setFetchedRate, setRateSource, setCurDropdown,
    setReceiptUri, setReceiptBusy, setAttempted, setInitKey,
  };
}
