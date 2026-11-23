begin;
do $$
declare
  v_subject text := repeat('a',64);
  v_other text := repeat('b',64);
  v_ent uuid;
begin
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'unknown';
  v_ent := paygate.fulfill_purchase('pdf2md','pass50','test-only@example.invalid',
    'cs_test_checkout_status','pi_test_checkout_status',200,'eur',repeat('c',64),v_subject);
  assert v_ent is not null, 'fulfill';
  assert paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'buyer';
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_other), 'other subject';
  assert paygate.refund_purchase('pi_test_checkout_status'), 'refund';
  assert not paygate.checkout_fulfilled('cs_test_checkout_status',v_subject), 'revoked';
  raise notice 'CHECKOUT STATUS TEST PASSED';
end $$;
rollback;
