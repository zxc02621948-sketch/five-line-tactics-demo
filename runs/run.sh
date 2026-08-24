set -e
cd E:/five_line_tactics_demo
G=1000
for mult in "3 2" "2.5 1.6" "2.25 1.5"; do
  set -- $mult
  tag="hp$1_atk$2"
  RANK2_HP=$1 RANK2_ATK=$2 TURN_ORDER_MODE=fixed node balance_lab.js $G ranker,balanced > runs/${tag}_balanced.json 2>/dev/null
  RANK2_HP=$1 RANK2_ATK=$2 TURN_ORDER_MODE=fixed node balance_lab.js $G ranker,counter > runs/${tag}_counter.json 2>/dev/null
  RANK2_HP=$1 RANK2_ATK=$2 COUNTER_SHARE_WEIGHT=0 COUNTER_RANK2_WEIGHT=0 TURN_ORDER_MODE=fixed \
    node balance_lab.js $G ranker,counter > runs/${tag}_control.json 2>/dev/null
  echo "done $tag"
done
echo ALL_DONE
