#!/bin/bash
set -e
BASE="http://localhost:3000"

echo "========================================="
echo "  STRAITS API — FULL END-TO-END TEST"
echo "========================================="

echo ""
echo ">>> 1. Create group"
GROUP=$(curl -s -X POST "$BASE/groups" -H 'Content-Type: application/json' -d '{"name":"Alpha Fund","threshold":0.6}')
GID=$(echo "$GROUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
VAULT=$(echo "$GROUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['vaultAddress'])")
echo "   Group: $GID"
echo "   Vault: $VAULT"

echo ""
echo ">>> 2. Add members"
N_JSON=$(curl -s -X POST "$BASE/groups/$GID/members" -H 'Content-Type: application/json' -d '{"handle":"nikhil","xrplAddress":"rMHztuap6iB4f7Ny2Ws2pKvoa7mmH4T42T"}')
NID=$(echo "$N_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   nikhil: $NID"

A_JSON=$(curl -s -X POST "$BASE/groups/$GID/members" -H 'Content-Type: application/json' -d '{"handle":"alice","xrplAddress":"rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"}')
AID=$(echo "$A_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   alice:  $AID"

echo ""
echo ">>> 3. Deposit: nikhil=60 XRP, alice=30 XRP"
curl -s -X POST "$BASE/groups/$GID/deposit" -H 'Content-Type: application/json' -d "{\"memberId\":\"$NID\",\"amount\":\"60\"}" > /dev/null
curl -s -X POST "$BASE/groups/$GID/deposit" -H 'Content-Type: application/json' -d "{\"memberId\":\"$AID\",\"amount\":\"30\"}" > /dev/null
echo "   Done."

echo ""
echo ">>> 4. Voting weights"
curl -s "$BASE/groups/$GID/voting-weights" | python3 -c "
import sys,json
w=json.load(sys.stdin)
for v in w.values():
    print(f'   {v[\"handle\"]}: {v[\"weight\"]*100:.1f}% ({v[\"deposited\"]} XRP)')
"

echo ""
echo ">>> 5. Propose trade: Long OIL \$30"
PROP=$(curl -s -X POST "$BASE/proposals" -H 'Content-Type: application/json' -d "{\"groupId\":\"$GID\",\"proposerId\":\"$NID\",\"type\":\"prediction\",\"description\":\"Long OIL - Hormuz tension\",\"market\":\"OIL\",\"side\":\"long\",\"amount\":30}")
PID=$(echo "$PROP" | python3 -c "import sys,json; print(json.load(sys.stdin)['proposal']['id'])")
echo "   Proposal: $PID (status: open)"

echo ""
echo ">>> 6. Nikhil votes YES → quorum hit → XRPL escrow created"
VOTE=$(curl -s -X POST "$BASE/proposals/$PID/vote" -H 'Content-Type: application/json' -d "{\"memberId\":\"$NID\",\"vote\":\"yes\"}")
echo "$VOTE" | python3 -m json.tool

echo ""
echo ">>> 7. Settle: trade won @ 1.18x → finish escrow → payouts"
SETTLE=$(curl -s -X POST "$BASE/settlement/settle" -H 'Content-Type: application/json' -d "{\"proposalId\":\"$PID\",\"outcome\":\"win\",\"returnMultiplier\":1.18}")
echo "$SETTLE" | python3 -m json.tool

echo ""
echo "========================================="
echo "  TEST COMPLETE"
echo "========================================="
