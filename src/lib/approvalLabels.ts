// Plain-language names for every server approval action (requireApproval
// `action`), shown in the manager-approval dialog. approvalLabels.test.ts
// fails when a server action has no label here.
export const ACTION_LABELS: Record<string, string> = {
  'payment.void': 'Void a payment',
  'payment.refund': 'Record a refund',
  'job.pickup_unpaid': 'Release an order with a balance due',
  'job.delete': 'Remove an order',
  'job.unarchive': 'Restore a removed order',
  'customer.delete': 'Archive a customer',
  'customer.unarchive': 'Restore an archived customer',
  'customer.credit_adjust': 'Adjust store credit',
  'inventory.adjust': 'Change a stock count',
  'cycle_count.post': 'Approve & post a cycle count',
  'invoice.void': 'Void an invoice (cancel the sale)',
  'return.refund': 'Refund a return over the approval limit',
  'price.override': 'Charge a price different from the suggested price',
};
