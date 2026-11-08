"""Pick the iPhone to test on from `xcrun simctl list devices available -j`.

The newest iOS runtime; on it, an iPhone 17 if there is one, else the last
iPhone by name. Prints the UDID; fails loudly if there is no iPhone at all.
"""
import json
import re
import sys

devices = json.load(sys.stdin)["devices"]


def version(runtime):
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)


runtimes = sorted((r for r in devices if "iOS" in r), key=version)
for runtime in reversed(runtimes):
    phones = [d for d in devices[runtime] if d["name"].startswith("iPhone")]
    if not phones:
        continue
    exact = [d for d in phones if d["name"] == "iPhone 17"]
    pick = exact[0] if exact else sorted(phones, key=lambda d: d["name"])[-1]
    print(f"{pick['name']} on {runtime}", file=sys.stderr)
    print(pick["udid"])
    sys.exit(0)
sys.exit("no iPhone simulator on this runner")
