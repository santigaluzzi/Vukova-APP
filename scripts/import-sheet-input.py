"""Send a reviewed input file to the app. Read the temporary token from stdin."""
import json
import sys
import urllib.request
import urllib.error

settings = json.loads(sys.stdin.readline())
with open(sys.argv[1], encoding="utf-8") as source:
    payloads = json.load(source)
for index, payload in enumerate(payloads):
    if index < int(sys.argv[2] if len(sys.argv) > 2 else 0):
        continue
    request = urllib.request.Request(
        settings["url"] + "/api/imports/sheets",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + settings["token"], "User-Agent": "VukovaAdminMigration/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        print(json.dumps({"index": index, "status": error.code, "error": error.read().decode()}, ensure_ascii=False), flush=True)
        sys.exit(1)
    print(json.dumps({"index": index, "sheet": payload.get("sheetName", payload.get("id")), **result}, ensure_ascii=False), flush=True)
