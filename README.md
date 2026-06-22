
A backend system that models a real bank's ledger using Event Sourcing + CQRS + Double-Entry Bookkeeping. Every financial transaction is stored as an immutable event. The current account balance is derived by replaying events. All money movements follow double-entry rules (debits = credits).
