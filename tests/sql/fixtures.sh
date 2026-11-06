# fixtures: 3 cajeros con caja abierta en TC; producto LAST con stock N
P="psql -h /tmp/pgt -p 5444 -U pgt -q -At t1"
U1=00000000-0000-0000-0000-000000000101; U2=00000000-0000-0000-0000-000000000102; U3=00000000-0000-0000-0000-000000000103; ADM=00000000-0000-0000-0000-0000000000aa
SC=$($P -c "select id from sedes where codigo='TC'")
as() { PGOPTIONS="-c request.uid=$1" psql -h /tmp/pgt -p 5444 -U pgt -q -At t1 "${@:2}"; }
