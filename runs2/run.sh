set -e
cd E:/five_line_tactics_demo
for hp in 3 2.5 2; do
  RANK2_HP=$hp RANK2_ATK=2 TURN_ORDER_MODE=fixed \
    node balance_lab.js 1000 up0,up25,up50,up75,up100 > runs2/hp${hp}.json 2>/dev/null
  echo "done hp=$hp"
done
echo ALL_DONE
