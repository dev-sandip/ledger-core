## Project: "LedgerCore" — Event-Sourced Double-Entry Bank Core

### What It Is
A backend system that models a real bank's ledger using **Event Sourcing + CQRS + Double-Entry Bookkeeping**. Every financial transaction is stored as an immutable event. The current account balance is derived by replaying events. All money movements follow double-entry rules (debits = credits).

### Why This Project?
- Banking is the canonical use case for event sourcing — money must never be lost or created
- Double-entry bookkeeping is the mathematical guarantee that your ledger is consistent
- NestJS + `@nestjs/cqrs` provides a clean framework for this architecture


## Core Features to Implement

| Feature | Description |
|---------|-------------|
| **Open Account** | Create checking/savings/loan accounts |
| **Deposit** | Credit account, debit bank's deposit liability |
| **Withdraw** | Debit account, credit bank's deposit liability |
| **Transfer** | Move money between two accounts (saga pattern) |
| **Balance Inquiry** | Query projected read model |
| **Transaction History** | Replay events for any account |
| **Audit Trail** | Every event is immutable and timestamped |



## Architecture (NestJS + CQRS + Event Sourcing)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           API Gateway (NestJS)                          │
│  POST /accounts        POST /accounts/:id/deposit                       │
│  GET  /accounts/:id    POST /accounts/:id/withdraw                      │
│  GET  /accounts/:id/transactions   POST /transfers                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                       ▼
┌───────────────┐                                    ┌──────────────────┐
│  COMMAND SIDE │                                    │   QUERY SIDE     │
│  (Writes)     │                                    │   (Reads)        │
│               │                                    │                  │
│  CommandBus   │──► CommandHandler ──► Aggregate ──► EventStore     │
│               │         │                │    │      │  (Postgres)     │
│               │         │                │    └──► Events persisted   │
│               │         │                │           │                  │
│               │         │                └──► apply() ──► Events      │
│               │         │                           │                  │
│               │         └──► Domain logic           │                  │
│               │              (invariants)             │                  │
└───────────────┘                                     └──────────────────┘
        │                                                       ▲
        │                                                       │
        │              ┌─────────────────────┐                    │
        │              │   Event Bus         │                    │
        │              │   (NestJS internal) │────────────────────┘
        │              └─────────────────────┘    Event Handlers
        │                                         update Read DB
        │              ┌─────────────────────┐
        └─────────────►│   Read DB           │
                       │   (Postgres)        │
                       │   Projected tables:  │
                       │   - accounts         │
                       │   - transactions     │
                       │   - balances         │
                       └─────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | NestJS + `@nestjs/cqrs` | Built-in CommandBus, QueryBus, EventBus, AggregateRoot |
| **Event Store** | PostgreSQL (dedicated) | Append-only, ordered, durable. Can swap for EventStoreDB later |
| **Read Database** | PostgreSQL (separate connection) | Optimized projections for queries |
| **ORM** | TypeORM | Dual database connections, subscribers for event publishing |
| **Message Bus** | NestJS EventBus (in-process) | For projections; later upgrade to Kafka/RabbitMQ |
| **API Docs** | Swagger/OpenAPI | Auto-generated from DTOs |


## Domain Model: Double-Entry Bookkeeping

The heart of your system. Every transaction affects at least two accounts.

### Core Entities

```typescript
// Account (Aggregate Root)
class Account extends VersionedAggregateRoot {
  id: string;           // UUID
  type: AccountType;    // CHECKING, SAVINGS, LOAN
  currency: string;     // USD, EUR
  status: AccountStatus; // ACTIVE, FROZEN, CLOSED
  balance: Money;       // Value object
  
  deposit(amount: Money, source: string): void
  withdraw(amount: Money): void
  transferOut(amount: Money, toAccountId: string): void
  transferIn(amount: Money, fromAccountId: string): void
}

// JournalEntry (Double-Entry Record)
class JournalEntry {
  id: string;
  reference: string;      // External reference
  lineItems: LineItem[];  // Must sum to zero (debits = credits)
  timestamp: Date;
}

class LineItem {
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amount: Money;
}
```

### The Golden Rule
> **Sum of all debits must equal sum of all credits in every JournalEntry.**

This is your mathematical invariant. If this ever breaks, you have a bug that creates or destroys money.



## Event Types (Your Domain Events)

```typescript
// Account lifecycle
AccountOpenedEvent
AccountClosedEvent
AccountFrozenEvent
AccountUnfrozenEvent

// Money movements (always in pairs via JournalEntry)
MoneyDepositedEvent      // Credit customer account, debit bank liability
MoneyWithdrawnEvent      // Debit customer account, credit bank liability
TransferInitiatedEvent   // Saga start
TransferDebitedEvent     // Money left source account
TransferCreditedEvent    // Money arrived in destination account
TransferCompletedEvent   // Saga end

// Journal entries (the double-entry record)
JournalEntryPostedEvent  // Immutable record of the transaction
```



## Critical Design Patterns

### 1. Stream Per Account
Each account gets its own event stream (`account-{uuid}`). This enables:
- Independent optimistic locking per account
- Efficient replay (only replay one account's events)
- Horizontal scaling

### 2. Inter-Account Transfers (Saga Pattern)
You cannot atomically update two account streams. Use a saga:

```
1. TransferInitiatedEvent     (correlationId: tx-123)
2. TransferDebitedEvent       (source account stream)
3. TransferCreditedEvent      (destination account stream)
4. TransferCompletedEvent     (marks saga complete)
```

If step 3 fails, emit a `TransferFailedEvent` and compensate (credit back the source account).

### 3. Snapshots for Performance
Replaying 10,000 events per account is slow. Create snapshots every N events:

```
Current State = Snapshot(at version 1000) + Events(1001 to current)
```

### 4. Optimistic Concurrency
Use the `version` field on aggregates. When persisting, check:
```sql
-- Only insert if expected version matches
INSERT INTO events (stream_id, position, ...)
VALUES ('account-123', 5, ...)
WHERE NOT EXISTS (
  SELECT 1 FROM events 
  WHERE stream_id = 'account-123' AND position >= 5
);
```

## NestJS Project Structure

```
ledger-core/
├── src/
│   ├── main.ts                          # Bootstrap with Swagger
│   ├── app.module.ts                    # Root module
│   │
│   ├── core/                            # Infrastructure
│   │   ├── core.module.ts               # Dual DB connections
│   │   └── core.constants.ts            # Connection names
│   │
│   ├── shared/                          # Reusable event sourcing
│   │   ├── domain/
│   │   │   ├── aggregate-root.ts        # VersionedAggregateRoot
│   │   │   └── value-objects/
│   │   │       ├── version.ts
│   │   │       └── money.ts             # Currency-safe arithmetic
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   └── event-store.port.ts  # Abstract event store
│   │   │   └── aggregate-rehydrator.ts
│   │   └── infrastructure/
│   │       ├── event-store/
│   │       │   ├── entities/
│   │       │   │   └── event.entity.ts  # streamId, position, type, data
│   │       │   ├── pg-event-store.ts    # Postgres implementation
│   │       │   ├── event.serializer.ts
│   │       │   ├── event.deserializer.ts
│   │       │   ├── event-cls.registry.ts
│   │       │   └── event-subscriber.ts  # Publishes to EventBus after insert
│   │       └── shared.module.ts
│   │
│   ├── accounts/                        # Bounded Context: Accounts
│   │   ├── domain/
│   │   │   ├── account.ts               # Aggregate root
│   │   │   ├── factories/
│   │   │   │   └── account.factory.ts
│   │   │   ├── events/
│   │   │   │   ├── account-opened.event.ts
│   │   │   │   ├── money-deposited.event.ts
│   │   │   │   ├── money-withdrawn.event.ts
│   │   │   │   └── ...
│   │   │   └── value-objects/
│   │   │       ├── account-type.ts
│   │   │       └── account-status.ts
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   │   ├── impl/
│   │   │   │   │   ├── open-account.command.ts
│   │   │   │   │   ├── deposit.command.ts
│   │   │   │   │   └── withdraw.command.ts
│   │   │   │   └── handlers/
│   │   │   │       ├── open-account.handler.ts
│   │   │   │       ├── deposit.handler.ts
│   │   │   │       └── withdraw.handler.ts
│   │   │   ├── queries/
│   │   │   │   ├── impl/
│   │   │   │   │   ├── get-account.query.ts
│   │   │   │   │   └── get-balance.query.ts
│   │   │   │   └── handlers/
│   │   │   │       ├── get-account.handler.ts
│   │   │   │       └── get-balance.handler.ts
│   │   │   ├── event-handlers/
│   │   │   │   ├── account-opened.handler.ts    # Project to read DB
│   │   │   │   ├── money-deposited.handler.ts
│   │   │   │   └── money-withdrawn.handler.ts
│   │   │   └── accounts.service.ts
│   │   ├── infrastructure/
│   │   │   ├── persistence/
│   │   │   │   ├── entities/
│   │   │   │   │   └── account.entity.ts        # Read model
│   │   │   │   └── repositories/
│   │   │   │       ├── find-account.repo.ts
│   │   │   │       └── upsert-account.repo.ts
│   │   │   └── account-infrastructure.module.ts
│   │   ├── presentation/
│   │   │   └── http/
│   │   │       ├── accounts.controller.ts
│   │   │       └── dto/
│   │   │           ├── open-account.dto.ts
│   │   │           ├── deposit.dto.ts
│   │   │           └── withdraw.dto.ts
│   │   └── accounts.module.ts
│   │
│   ├── journal/                         # Bounded Context: Journal Entries
│   │   ├── domain/
│   │   │   ├── journal-entry.ts         # Aggregate
│   │   │   └── events/
│   │   │       └── journal-entry-posted.event.ts
│   │   └── ...
│   │
│   └── transfers/                       # Bounded Context: Transfers
│       ├── domain/
│       │   ├── transfer.ts              # Saga aggregate
│       │   └── events/
│       │       ├── transfer-initiated.event.ts
│       │       ├── transfer-debited.event.ts
│       │       ├── transfer-credited.event.ts
│       │       └── transfer-completed.event.ts
│       └── ...
│
├── docker-compose.yml                   # Postgres x2 + optional EventStoreDB
├── .env                                 # DB connection strings
└── package.json
```


## Where to Read & Learn

### 1. The Complete NestJS CQRS + Event Sourcing Tutorial (⭐ Start Here)
**"Designing Scalable Systems with CQRS and Event Sourcing"** by meesegberts.nl 

This is the **best hands-on guide** for exactly what you want. It covers:
- Setting up dual databases (event store + read model) in NestJS
- Building a generic `EventStore` port with PostgreSQL
- `VersionedAggregateRoot` with optimistic concurrency
- `AggregateRehydrator` for rebuilding state from events
- Event serialization/deserialization with a class registry
- Command handlers, query handlers, and projection event handlers
- Complete working code with Swagger UI

**Key code patterns you'll reuse:**
```typescript
// Event store schema
@Entity('events')
@Index(['streamId', 'position'], { unique: true })
export class EventEntity {
  @PrimaryColumn() streamId: string;
  @PrimaryColumn() position: number;
  @Column() type: string;
  @Column('json') data: Record<string, any>;
}

// Aggregate rehydration
async rehydrate<T>(aggregateId: string, AggregateCls: Type<T>): Promise<T> {
  const events = await this.eventStore.getEventsByStreamId(aggregateId);
  const aggregate = new AggregateCls(aggregateId);
  aggregate.loadFromHistory(events);
  return aggregate;
}
```

### 2. NestJS CQRS with EventStoreDB (Alternative Backend)
**"Building a CQRS and Event Sourcing Application for Hotel Management with NestJS and EventStoreDB"** 

Shows how to use **EventStoreDB** (a purpose-built event database) instead of PostgreSQL. Good for understanding:
- gRPC connection to EventStoreDB
- Stream naming conventions (`$ce-user` for category streams)
- Catch-up subscriptions vs persistent subscriptions

### 3. Event Sourcing Theory & Best Practices
**"Event Sourcing: A Practical Guide to Actually Getting It Done"** (Medium, SSENSE Tech) 

Covers:
- Event versioning with SEMVER (critical for evolving your system)
- Intent-focused vs state-focused events
- Compensating events (how to "undo" in an immutable system)
- Why you should never update event data

### 4. Microsoft's Official Event Sourcing Pattern Guide
**"Event Sourcing Pattern - Azure Architecture Center"** 

Authoritative reference covering:
- Why event sourcing + CQRS are commonly combined
- Event design principles (capture business intent, not just state)
- Eventual consistency considerations
- Snapshot optimization strategies
- Compensating transaction patterns

### 5. Double-Entry Accounting + Event Sourcing
**Stack Overflow: "Double Entry Accounting System Using Event Sourcing"** 

Key insight:
> "In each transaction (event) the amount is accounted twice. On the debit side and on the credit side of the transaction."

Also discusses:
- Physical pre-computer event-sourced systems (metric books, banking ledgers)
- What to lock on (the entity/stream)
- Derived models for current balance vs full event history

### 6. Hacker News Discussion: Real FinTech Event Sourcing
**"Event Sourcing, CQRS and Micro Services: Real FinTech Example"** 

Practical wisdom from production systems:
> "Any problem with event sourcing can be solved with more events."

Discusses inter-system transfers:
> "XTransactionStarted, XTransactionDepositConfirmed, and XTransactionCreditConfirmed"

And the core insight:
> "A double-entry ledger is a particular result of processing those events — a view."

### 7. Event Storage in PostgreSQL (Schema Design)
**Stack Overflow: "Preferred way of handling Event Sourcing in NestJS CQRS recipe"** 

References the classic **"Event Storage in Postgres"** article by Kasey Speakman. Key schema:

```sql
CREATE TABLE Event (
    SequenceNum bigserial NOT NULL,
    StreamId uuid NOT NULL,
    Version int NOT NULL,
    Data jsonb NOT NULL,
    Type text NOT NULL,
    Meta jsonb NOT NULL,
    LogDate timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (SequenceNum),
    UNIQUE (StreamId, Version)
);
```

### 8. NestJS Event Store Library
**`juicycleff/nestjs-event-store` on GitHub** 

A production-ready NestJS module for EventStoreDB with:
- Feature module registration
- Catch-up, volatile, and persistent subscriptions
- Event handler mapping
- MongoDB adapter for checkpoint tracking

---

## Implementation Roadmap

| Phase | What to Build | Time Estimate |
|-------|--------------|---------------|
| **1. Foundation** | Set up NestJS, dual DBs, shared event store infrastructure, generic aggregate root | 2-3 days |
| **2. Account Context** | Open account, deposit, withdraw with double-entry journal entries | 3-4 days |
| **3. Read Models** | Project account balances, transaction history to read DB | 1-2 days |
| **4. Transfer Context** | Inter-account transfers using saga pattern | 2-3 days |
| **5. Production Hardening** | Optimistic concurrency, snapshots, outbox pattern, idempotency | 3-4 days |
| **6. Observability** | Event replay for debugging, audit endpoints, correlation IDs | 2 days |


## Key Code Patterns You'll Need

### Aggregate Root (from the tutorial)
```typescript
export class Account extends VersionedAggregateRoot {
  public id: string;
  public balance: Money;
  public status: AccountStatus;

  deposit(amount: Money, source: string) {
    if (this.status === 'FROZEN') throw new Error('Account frozen');
    this.apply(new MoneyDepositedEvent(this.id, amount, source));
  }

  onMoneyDepositedEvent(event: MoneyDepositedEvent) {
    this.balance = this.balance.add(event.amount);
  }
}
```

### Command Handler
```typescript
@CommandHandler(DepositCommand)
export class DepositHandler implements ICommandHandler<DepositCommand> {
  constructor(
    private rehydrator: AggregateRehydrator,
    private publisher: EventPublisher,
  ) {}

  async execute(command: DepositCommand) {
    const account = await this.rehydrator.rehydrate(command.accountId, Account);
    account.deposit(command.amount, command.source);
    account.commit();
    return account;
  }
}
```

### Projection Event Handler
```typescript
@EventsHandler(MoneyDepositedEvent)
export class MoneyDepositedProjection implements IEventHandler<MoneyDepositedEvent> {
  constructor(private repo: UpsertAccountRepository) {}

  async handle(event: MoneyDepositedEvent) {
    await this.repo.upsert({
      id: event.accountId,
      $inc: { balance: event.amount },  // Atomic increment
    });
  }
}
```


## Final Advice

1. **Start with the tutorial** (meesegberts.nl) — it gives you a working NestJS CQRS + Event Sourcing foundation in ~2 hours
2. **Add double-entry on top** — every money movement creates a `JournalEntryPostedEvent` with balanced line items
3. **Use PostgreSQL first** — you can always swap to EventStoreDB later; the port/adapter pattern makes this easy
4. **Test with event replay** — write tests that replay your events and assert the final state; this is your safety net

Want me to generate a starter codebase for any specific part — like the `Money` value object, the double-entry journal entry aggregate, or the transfer saga?
