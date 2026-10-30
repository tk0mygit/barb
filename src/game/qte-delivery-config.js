// S1 D03/D05 development parameters. Device measurements and PM acceptance
// are still required before enabling product QTE. These are not measured limits.
export const QTE_DELIVERY_CONFIG = Object.freeze({
  receiptGraceMs: 100,
  semanticEdgeCapacity: 128,
  diagnosticCapacity: 32,
  clockHistoryCapacity: 32,
});
