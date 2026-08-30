// Asking two public APIs what a currency was worth.
//
// This file is transport and nothing else. Which source to believe, in what
// order, what counts as a usable number and how to convert it are all decided
// in Rust — `rates.rs` under a corpus. What is here is a request, a timeout,
// and turning a JSON body into a number or into nothing.
//
// The only thing this app ever sends over the network: a currency pair and a
// date. No ledger row leaves the phone.
//
// Both APIs answer "1 base = X target". Neither number is used as it stands —
// `resolveRate` inverts it into the store's "1 foreign = N base". Doing that
// here would put the convention in two places.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'src/rust/api/rates.dart' as rates;

/// Frankfurter has history, so it is asked for the entry's own date.
const _frankfurter = 'https://api.frankfurter.app';

/// exchangerate-api only has today, which is why the core gates it on the
/// date being recent.
const _exchangerate = 'https://api.exchangerate-api.com/v4/latest';

/// Long enough for a slow network, short enough that a save does not hang on it.
const _timeout = Duration(seconds: 15);

/// One API's answer, or nothing.
///
/// A failed request, a non-200, malformed JSON, a missing key and a value that
/// is not a number are all the same thing to the caller — the shipping app's
/// `j?.rates?.[target]` yields undefined for every one of them, and the core
/// takes `None` for all of them too.
typedef Fetch = Future<double?> Function(Uri url, String target);

Future<double?> _get(Uri url, String target) async {
  try {
    final r = await http.get(url).timeout(_timeout);
    if (r.statusCode != 200) return null;
    final body = jsonDecode(r.body);
    if (body is! Map) return null;
    final table = body['rates'];
    if (table is! Map) return null;
    final v = table[target];
    return v is num ? v.toDouble() : null;
  } catch (_) {
    // A timeout, a DNS failure, a captive portal, malformed JSON. The core
    // treats "no answer" and "a bad answer" identically, and so does this.
    return null;
  }
}

/// The rate for `target` in `base` on `day`, and where it came from.
///
/// `day` is `y-m-d` in the device's own calendar and `nowMinutes` is minutes
/// past local midnight — the clock stays on this side, as it does everywhere.
///
/// `cached` is what the store already holds, already in the app's convention.
/// It is the answer when the network says nothing, which is the ordinary case
/// on a phone with no signal rather than a failure worth reporting.
Future<rates.ResolvedRate> fetchRate({
  required String base,
  required String target,
  required String day,
  required String today,
  required int nowMinutes,
  double? cached,
  Fetch fetch = _get,
}) async {
  if (base == target) {
    return rates.resolveRate(
      sameCurrency: true,
      liveAllowed: false,
    );
  }

  final liveAllowed =
      rates.rateDateIsRecent(date: day, today: today, nowMinutes: nowMinutes);

  // The historical source is asked first and always; the live one only when
  // the core says the date is close enough to be worth a second request.
  final historical = await fetch(
    Uri.parse('$_frankfurter/$day?from=$base&to=$target'),
    target,
  );
  final live = liveAllowed
      ? await fetch(Uri.parse('$_exchangerate/$base'), target)
      : null;

  return rates.resolveRate(
    sameCurrency: false,
    historical: historical,
    liveAllowed: liveAllowed,
    live: live,
    cached: cached,
  );
}
