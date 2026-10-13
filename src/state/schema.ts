/**
 * Automaton SQLite Schema
 *
 * All tables for the automaton's persistent state.
 * The database IS the automaton's memory.
 */

export const SCHEMA_VERSION = 16;

export const CREATE_TABLES = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Core identity key-value store
  CREATE TABLE IF NOT EXISTS identity (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Agent reasoning turns (the thinking/action log)
  -- Application-level validation: state must be a valid AgentState ('setup','waking','running','sleeping','low_compute','critical','dead')
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    state TEXT NOT NULL,
    input TEXT,
    input_source TEXT,
    thinking TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    token_usage TEXT NOT NULL DEFAULT '{}',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tool call results (denormalized for fast lookup)
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES turns(id),
    name TEXT NOT NULL,
    arguments TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat configuration entries
  -- Application-level validation: enabled must be 0 or 1 (boolean integer)
  CREATE TABLE IF NOT EXISTS heartbeat_entries (
    name TEXT PRIMARY KEY,
    schedule TEXT NOT NULL,
    task TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    params TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Financial transaction log
  -- Application-level validation: type must be one of 'transfer_out','transfer_in','credit_purchase','topup','x402_payment','inference'
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount_cents INTEGER,
    balance_after_cents INTEGER,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed tools and MCP servers
  CREATE TABLE IF NOT EXISTS installed_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  );

  -- Self-modification audit log (append-only)
  CREATE TABLE IF NOT EXISTS modifications (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    diff TEXT,
    reversible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- General key-value store for arbitrary state
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed skills
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Spawned child automatons
  -- Application-level validation: status must be one of 'spawning','running','sleeping','dead','unknown'
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  -- ERC-8004 registration state
  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Reputation feedback received and given
  -- Application-level validation: score must be 1-5
  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indices for common queries
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_turns_state ON turns(state);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_modifications_type ON modifications(type);
  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);

  -- Inbox messages table
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V3 = `
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V4 = `
  -- Policy decisions table
  CREATE TABLE IF NOT EXISTS policy_decisions (
    id TEXT PRIMARY KEY,
    turn_id TEXT,
    tool_name TEXT NOT NULL,
    tool_args_hash TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','dangerous','forbidden')),
    decision TEXT NOT NULL CHECK(decision IN ('allow','deny','quarantine')),
    rules_evaluated TEXT NOT NULL DEFAULT '[]',
    rules_triggered TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_policy_decisions_turn ON policy_decisions(turn_id);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_tool ON policy_decisions(tool_name);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON policy_decisions(decision);

  -- Spend tracking table
  CREATE TABLE IF NOT EXISTS spend_tracking (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    recipient TEXT,
    domain TEXT,
    category TEXT NOT NULL CHECK(category IN ('transfer','x402','inference','other')),
    window_hour TEXT NOT NULL,
    window_day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(category, window_hour);
  CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(category, window_day);

  -- Heartbeat schedule (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_schedule (
    task_name TEXT PRIMARY KEY,
    cron_expression TEXT NOT NULL,
    interval_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    max_retries INTEGER NOT NULL DEFAULT 1,
    tier_minimum TEXT NOT NULL DEFAULT 'dead'
      CHECK(tier_minimum IN ('dead','critical','low_compute','normal','high')),
    last_run_at TEXT,
    next_run_at TEXT,
    last_result TEXT CHECK(last_result IN ('success','failure','timeout','skipped') OR last_result IS NULL),
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat history (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_history (
    id TEXT PRIMARY KEY,
    task_name TEXT NOT NULL REFERENCES heartbeat_schedule(task_name),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT NOT NULL CHECK(result IN ('success','failure','timeout','skipped')),
    duration_ms INTEGER,
    error TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hb_history_task ON heartbeat_history(task_name, started_at);

  -- Wake events (Phase 1.1)
  CREATE TABLE IF NOT EXISTS wake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wake_unconsumed ON wake_events(created_at) WHERE consumed_at IS NULL;

  -- Heartbeat dedup (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_dedup (
    dedup_key TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_dedup_expires ON heartbeat_dedup(expires_at);

  -- Data migration: heartbeat_entries -> heartbeat_schedule
  INSERT OR IGNORE INTO heartbeat_schedule (task_name, cron_expression, enabled, last_run_at, next_run_at)
  SELECT name, schedule, enabled, last_run, next_run FROM heartbeat_entries;
`;

// Inbox modifications for V4 (ALTER TABLE must be run separately from CREATE TABLE)
export const MIGRATION_V4_ALTER = `
  ALTER TABLE inbox_messages ADD COLUMN to_address TEXT;
`;

export const MIGRATION_V4_ALTER2 = `
  ALTER TABLE inbox_messages ADD COLUMN raw_content TEXT;
`;

// Inbox state machine columns (Phase 1.2)
// Note: SQLite ALTER TABLE ADD COLUMN cannot include CHECK constraints,
// so status validation is enforced at the application level.
export const MIGRATION_V4_ALTER_INBOX_STATUS = `
  ALTER TABLE inbox_messages ADD COLUMN status TEXT DEFAULT 'received';
`;

export const MIGRATION_V4_ALTER_INBOX_RETRY = `
  ALTER TABLE inbox_messages ADD COLUMN retry_count INTEGER DEFAULT 0;
`;

export const MIGRATION_V4_ALTER_INBOX_MAX_RETRIES = `
  ALTER TABLE inbox_messages ADD COLUMN max_retries INTEGER DEFAULT 3;
`;

export const MIGRATION_V2 = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);
`;

// === Phase 2.1 + 2.2: Soul + Memory Tables ===

export const MIGRATION_V5 = `
  -- === Phase 2.1: Soul System ===

  CREATE TABLE IF NOT EXISTS soul_history (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_source TEXT NOT NULL CHECK(change_source IN ('agent','human','system','genesis','reflection')),
    change_reason TEXT,
    previous_version_id TEXT REFERENCES soul_history(id),
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_soul_version ON soul_history(version);

  -- === Phase 2.2: Memory System ===

  CREATE TABLE IF NOT EXISTS working_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('goal','observation','plan','reflection','task','decision','note','summary')),
    priority REAL NOT NULL DEFAULT 0.5,
    token_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    source_turn TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id, priority);

  CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    outcome TEXT CHECK(outcome IN ('success','failure','partial','neutral') OR outcome IS NULL),
    importance REAL NOT NULL DEFAULT 0.5,
    embedding_key TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    classification TEXT NOT NULL DEFAULT 'maintenance' CHECK(classification IN ('strategic','productive','communication','maintenance','idle','error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(event_type);
  CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
  CREATE INDEX IF NOT EXISTS idx_episodic_classification ON episodic_memory(classification);

  CREATE TABLE IF NOT EXISTS session_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    tools_used TEXT NOT NULL DEFAULT '[]',
    outcomes TEXT NOT NULL DEFAULT '[]',
    turn_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('self','environment','financial','agent','domain','procedural_ref','creator')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    embedding_key TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memory(category);

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    steps TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relationship_memory (
    id TEXT PRIMARY KEY,
    entity_address TEXT NOT NULL UNIQUE,
    entity_name TEXT,
    relationship_type TEXT NOT NULL,
    trust_score REAL NOT NULL DEFAULT 0.5,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_trust ON relationship_memory(trust_score);
`;

// === Phase 2.3: Inference & Model Strategy Tables ===

export const MIGRATION_V6 = `
  -- === Phase 2.3: Inference & Model Strategy ===

  CREATE TABLE IF NOT EXISTS inference_costs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('agent_turn','heartbeat_triage','safety_check','summarization','planning')),
    cache_hit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inf_session ON inference_costs(session_id);
  CREATE INDEX IF NOT EXISTS idx_inf_model ON inference_costs(model);
  CREATE INDEX IF NOT EXISTS idx_inf_created ON inference_costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_inf_task ON inference_costs(task_type);

  CREATE TABLE IF NOT EXISTS model_registry (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tier_minimum TEXT NOT NULL DEFAULT 'normal',
    cost_per_1k_input INTEGER NOT NULL DEFAULT 0,
    cost_per_1k_output INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    context_window INTEGER NOT NULL DEFAULT 128000,
    supports_tools INTEGER NOT NULL DEFAULT 1,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    parameter_style TEXT NOT NULL DEFAULT 'max_tokens' CHECK(parameter_style IN ('max_tokens','max_completion_tokens')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// === Phase 3: Replication + Social ===

export const MIGRATION_V7 = `
  -- === Phase 3.1: Replication Lifecycle ===

  CREATE TABLE IF NOT EXISTS child_lifecycle_events (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL CHECK(to_state IN (
      'requested','sandbox_created','runtime_ready','wallet_verified',
      'funded','starting','healthy','unhealthy','stopped','failed','cleaned_up'
    )),
    reason TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_child_events ON child_lifecycle_events(child_id, created_at);

  -- === Phase 3.2: Social & Registry ===

  CREATE TABLE IF NOT EXISTS discovered_agents_cache (
    agent_address TEXT PRIMARY KEY,
    agent_card TEXT NOT NULL,
    fetched_from TEXT NOT NULL,
    card_hash TEXT NOT NULL,
    valid_until TEXT,
    fetch_count INTEGER NOT NULL DEFAULT 1,
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onchain_transactions (
    id TEXT PRIMARY KEY,
    tx_hash TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    gas_used INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_onchain_status ON onchain_transactions(status);
`;

// === Phase 4.1: Observability ===

export const MIGRATION_V8 = `
  -- === Phase 4.1: Observability ===

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]',
    alerts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_at ON metric_snapshots(snapshot_at);
`;

// === Plan A: Orchestration + Memory ===

export const MIGRATION_V9 = `
  -- Schema version: 9
  -- Tables: goals, task_graph, event_stream

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,                    -- ULID
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active|completed|failed|paused
    strategy TEXT,
    expected_revenue_cents INTEGER DEFAULT 0,
    actual_revenue_cents INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deadline TEXT,
    completed_at TEXT
  );

  CREATE TABLE task_graph (
    id TEXT PRIMARY KEY,                    -- ULID
    parent_id TEXT,                         -- parent task (decomposition)
    goal_id TEXT NOT NULL REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending|assigned|running|completed|failed|blocked|cancelled
    assigned_to TEXT,                       -- agent wallet address (0x...)
    agent_role TEXT,                        -- predefined role name
    priority INTEGER DEFAULT 50,           -- 0-100
    dependencies TEXT DEFAULT '[]',        -- JSON array of task IDs
    result TEXT,                           -- JSON TaskResult
    estimated_cost_cents INTEGER DEFAULT 0,
    actual_cost_cents INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX idx_task_graph_goal ON task_graph(goal_id);
  CREATE INDEX idx_task_graph_status ON task_graph(status);
  CREATE INDEX idx_task_graph_assigned ON task_graph(assigned_to);

  CREATE TABLE event_stream (
    id TEXT PRIMARY KEY,                    -- ULID
    type TEXT NOT NULL,                     -- EventType enum
    agent_address TEXT NOT NULL,
    goal_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    compacted_to TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_events_agent ON event_stream(agent_address, created_at);
  CREATE INDEX idx_events_goal ON event_stream(goal_id, created_at);
  CREATE INDEX idx_events_type ON event_stream(type, created_at);
`;

// Role column for children table (must be separate statement for SQLite ALTER)
export const MIGRATION_V9_ALTER_CHILDREN_ROLE = `
  ALTER TABLE children ADD COLUMN role TEXT DEFAULT 'generalist';
`;

// === Solana Integration: Chain Type Column ===

export const MIGRATION_V11 = `
  -- Schema version: 11
  -- Add chain_type column to children table for multi-chain support
  ALTER TABLE children ADD COLUMN chain_type TEXT DEFAULT 'evm';
`;

export const MIGRATION_V10 = `
  -- Schema version: 10
  -- Tables: knowledge_store

  CREATE TABLE knowledge_store (
    id TEXT PRIMARY KEY,                    -- ULID
    category TEXT NOT NULL,                 -- market|technical|social|financial|operational
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,                   -- agent address that contributed
    confidence REAL DEFAULT 1.0,
    last_verified TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX idx_knowledge_category ON knowledge_store(category);
  CREATE INDEX idx_knowledge_key ON knowledge_store(key);
`;

// Product Factory foundations; no runtime activation or treasury changes.
export const MIGRATION_V12 = `
CREATE TABLE factory_opportunities (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','evaluating','accepted','rejected'))
);

CREATE INDEX idx_factory_opportunities_created ON factory_opportunities(created_at, id);

CREATE TABLE factory_evidence (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES factory_opportunities(id),
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1)
);

CREATE INDEX idx_factory_evidence_created ON factory_evidence(created_at, id);

CREATE TABLE factory_products (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  opportunity_id TEXT REFERENCES factory_opportunities(id),
  creator_address TEXT NOT NULL CHECK(length(trim(creator_address)) > 0),
  name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('draft','validating','building','paused','archived')),
  revenue_cents INTEGER NOT NULL CHECK(typeof(revenue_cents) = 'integer' AND revenue_cents >= 0)
);

CREATE INDEX idx_factory_products_created ON factory_products(created_at, id);

CREATE TABLE factory_hypotheses (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  statement TEXT NOT NULL,
  success_criterion TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','testing','supported','refuted')),
  UNIQUE(id, product_id)
);

CREATE INDEX idx_factory_hypotheses_product ON factory_hypotheses(product_id, created_at, id);

CREATE TABLE factory_experiments (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  hypothesis_id TEXT NOT NULL REFERENCES factory_hypotheses(id),
  goal_id TEXT REFERENCES goals(id),
  task_id TEXT REFERENCES task_graph(id),
  status TEXT NOT NULL CHECK(status IN ('planned','running','completed','cancelled')),
  method TEXT NOT NULL,
  UNIQUE(id, product_id),
  FOREIGN KEY(hypothesis_id, product_id) REFERENCES factory_hypotheses(id, product_id)
);

CREATE INDEX idx_factory_experiments_product ON factory_experiments(product_id, created_at, id);

CREATE TABLE factory_metric_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  experiment_id TEXT REFERENCES factory_experiments(id),
  metrics TEXT NOT NULL CHECK(json_valid(metrics) AND json_type(metrics) = 'object'),
  captured_at TEXT NOT NULL,
  FOREIGN KEY(experiment_id, product_id) REFERENCES factory_experiments(id, product_id)
);

CREATE INDEX idx_factory_metric_snapshots_product ON factory_metric_snapshots(product_id, created_at, id);

CREATE TABLE factory_feedback (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  source TEXT NOT NULL,
  content TEXT NOT NULL
);

CREATE INDEX idx_factory_feedback_product ON factory_feedback(product_id, created_at, id);

CREATE TABLE factory_features (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','planned','built','rejected')),
  task_id TEXT REFERENCES task_graph(id)
);

CREATE INDEX idx_factory_features_product ON factory_features(product_id, created_at, id);

CREATE TABLE factory_decisions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  rationale TEXT NOT NULL,
  evidence_ids TEXT NOT NULL CHECK(json_valid(evidence_ids) AND json_type(evidence_ids) = 'array'),
  outcome TEXT NOT NULL
);

CREATE INDEX idx_factory_decisions_product ON factory_decisions(product_id, created_at, id);

CREATE TABLE factory_learnings (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  experiment_id TEXT REFERENCES factory_experiments(id),
  content TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  FOREIGN KEY(experiment_id, product_id) REFERENCES factory_experiments(id, product_id)
);

CREATE INDEX idx_factory_learnings_product ON factory_learnings(product_id, created_at, id);

CREATE TABLE factory_resource_reservations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  task_id TEXT REFERENCES task_graph(id),
  resource TEXT NOT NULL CHECK(resource IN ('compute','storage','inference')),
  units REAL NOT NULL CHECK(units > 0),
  operational_cost_cents INTEGER NOT NULL CHECK(typeof(operational_cost_cents) = 'integer' AND operational_cost_cents >= 0),
  status TEXT NOT NULL CHECK(status IN ('requested','reserved','released')),
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_factory_resource_reservations_product ON factory_resource_reservations(product_id, created_at, id);

CREATE TABLE factory_capacity_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  available_compute_units REAL NOT NULL CHECK(available_compute_units >= 0),
  available_storage_mb REAL NOT NULL CHECK(available_storage_mb >= 0),
  available_operational_budget_cents INTEGER NOT NULL CHECK(typeof(available_operational_budget_cents) = 'integer' AND available_operational_budget_cents >= 0),
  captured_at TEXT NOT NULL
);

CREATE INDEX idx_factory_capacity_snapshots_created ON factory_capacity_snapshots(created_at, id);

CREATE TABLE factory_approvals (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  action TEXT NOT NULL CHECK(action IN ('prototype','experiment','resource_reservation')),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  CHECK((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL) OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE INDEX idx_factory_approvals_product ON factory_approvals(product_id, created_at, id);

CREATE TABLE factory_events (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES factory_products(id),
  type TEXT NOT NULL CHECK(type IN ('product.created','product.stage_changed','approval.decided')),
  actor TEXT NOT NULL CHECK(length(trim(actor)) > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object')
);

CREATE INDEX idx_factory_events_product ON factory_events(product_id, created_at, id);

CREATE TRIGGER factory_product_owner_immutable BEFORE UPDATE OF creator_address ON factory_products
WHEN NEW.creator_address != OLD.creator_address BEGIN SELECT RAISE(ABORT, 'Product creator is immutable'); END;
CREATE TRIGGER factory_approval_creator BEFORE UPDATE ON factory_approvals
WHEN NEW.status != 'pending' AND NEW.decided_by != (SELECT creator_address FROM factory_products WHERE id = NEW.product_id)
BEGIN SELECT RAISE(ABORT, 'Only the product creator can decide approvals'); END;
CREATE TRIGGER factory_approval_insert_creator BEFORE INSERT ON factory_approvals
WHEN NEW.status != 'pending' AND NEW.decided_by != (SELECT creator_address FROM factory_products WHERE id = NEW.product_id)
BEGIN SELECT RAISE(ABORT, 'Only the product creator can decide approvals'); END;
CREATE TRIGGER factory_events_no_update BEFORE UPDATE ON factory_events
BEGIN SELECT RAISE(ABORT, 'Factory events are append-only'); END;
CREATE TRIGGER factory_events_no_delete BEFORE DELETE ON factory_events
BEGIN SELECT RAISE(ABORT, 'Factory events are append-only'); END;
CREATE TRIGGER factory_events_no_replace BEFORE INSERT ON factory_events
WHEN EXISTS(SELECT 1 FROM factory_events WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Factory events are append-only'); END;
CREATE TRIGGER factory_product_no_replace BEFORE INSERT ON factory_products
WHEN EXISTS(SELECT 1 FROM factory_products WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Product replacement is forbidden'); END;
CREATE TRIGGER factory_approval_terminal BEFORE UPDATE ON factory_approvals
WHEN OLD.status != 'pending'
BEGIN SELECT RAISE(ABORT, 'Approval already decided'); END;
CREATE TRIGGER factory_approval_no_replace BEFORE INSERT ON factory_approvals
WHEN EXISTS(SELECT 1 FROM factory_approvals WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Approval replacement is forbidden'); END;
`;

// Additive Factory scheduling metadata; all work still lives in task_graph.
export const MIGRATION_V13 = `
ALTER TABLE factory_products ADD COLUMN portfolio_state TEXT NOT NULL DEFAULT 'research'
  CHECK(portfolio_state IN ('research','building','launch_ready','validation','optimizing','scaling','pivoting','killed','archived'));
UPDATE factory_products SET portfolio_state = CASE stage WHEN 'building' THEN 'building' WHEN 'validating' THEN 'validation' WHEN 'archived' THEN 'archived' ELSE 'research' END;
ALTER TABLE factory_products ADD COLUMN factory_paused INTEGER NOT NULL DEFAULT 0 CHECK(factory_paused IN (0,1));
ALTER TABLE factory_products ADD COLUMN factory_failure TEXT;
ALTER TABLE factory_approvals ADD COLUMN factory_action_id TEXT;
ALTER TABLE factory_resource_reservations ADD COLUMN resource_class TEXT NOT NULL DEFAULT 'compute'
  CHECK(resource_class IN ('build','research','monitoring','inference','compute','experiment'));
ALTER TABLE factory_resource_reservations ADD COLUMN managed INTEGER NOT NULL DEFAULT 0 CHECK(managed IN (0,1));
ALTER TABLE factory_resource_reservations ADD COLUMN released_reason TEXT;
ALTER TABLE factory_capacity_snapshots ADD COLUMN resource_capacity TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(resource_capacity));
ALTER TABLE task_graph ADD COLUMN product_id TEXT REFERENCES factory_products(id);
ALTER TABLE task_graph ADD COLUMN factory_action_id TEXT;
ALTER TABLE task_graph ADD COLUMN resource_class TEXT CHECK(resource_class IN ('build','research','monitoring','inference','compute','experiment'));
ALTER TABLE task_graph ADD COLUMN reservation_id TEXT REFERENCES factory_resource_reservations(id);
ALTER TABLE task_graph ADD COLUMN deadline TEXT;
ALTER TABLE task_graph ADD COLUMN urgency INTEGER NOT NULL DEFAULT 0 CHECK(urgency BETWEEN 0 AND 100);
ALTER TABLE task_graph ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0,1));
ALTER TABLE task_graph ADD COLUMN preemptible INTEGER NOT NULL DEFAULT 0 CHECK(preemptible IN (0,1));
ALTER TABLE task_graph ADD COLUMN critical_incident INTEGER NOT NULL DEFAULT 0 CHECK(critical_incident IN (0,1));
ALTER TABLE task_graph ADD COLUMN resource_units REAL NOT NULL DEFAULT 1 CHECK(resource_units > 0);
ALTER TABLE task_graph ADD COLUMN factory_details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(factory_details));
CREATE UNIQUE INDEX idx_factory_action ON task_graph(product_id, factory_action_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_factory_concurrency ON task_graph(product_id, resource_class, status);
CREATE UNIQUE INDEX idx_factory_managed_reservation ON factory_resource_reservations(task_id) WHERE managed = 1;
CREATE INDEX idx_factory_reservations_active ON factory_resource_reservations(status, resource_class, product_id);
CREATE TRIGGER factory_assignment_guard BEFORE UPDATE OF status ON task_graph
WHEN NEW.product_id IS NOT NULL AND NEW.status IN ('assigned','running') AND NOT EXISTS (
  SELECT 1 FROM factory_resource_reservations r WHERE r.id = NEW.reservation_id AND r.task_id = NEW.id
    AND r.product_id = NEW.product_id AND r.resource_class = NEW.resource_class AND r.managed = 1 AND r.status = 'reserved'
)
BEGIN SELECT RAISE(ABORT, 'Factory assignment requires a matching reservation'); END;
-- Other Task Graph helpers (including retry) cannot leave a Factory reservation active.
CREATE TRIGGER factory_release_task_reservation AFTER UPDATE OF status ON task_graph
WHEN NEW.product_id IS NOT NULL AND NEW.status NOT IN ('assigned','running')
BEGIN
  UPDATE factory_resource_reservations SET status = 'released', released_reason = NEW.status
    WHERE task_id = NEW.id AND status = 'reserved' AND managed = 1;
END;
`;

// Discovery metadata extends the same V12 tables. Decisions may precede products.
export const MIGRATION_V14 = `
ALTER TABLE factory_opportunities ADD COLUMN discovery_metadata TEXT CHECK(discovery_metadata IS NULL OR json_valid(discovery_metadata));
ALTER TABLE factory_evidence ADD COLUMN discovery_metadata TEXT CHECK(discovery_metadata IS NULL OR json_valid(discovery_metadata));
ALTER TABLE factory_evidence ADD COLUMN signal_fingerprint TEXT;
CREATE UNIQUE INDEX idx_factory_evidence_signal ON factory_evidence(opportunity_id, signal_fingerprint) WHERE signal_fingerprint IS NOT NULL;
CREATE INDEX idx_factory_evidence_opportunity ON factory_evidence(opportunity_id, id);
CREATE TABLE factory_decisions_v14 (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  created_at TEXT NOT NULL,
  product_id TEXT REFERENCES factory_products(id),
  opportunity_id TEXT REFERENCES factory_opportunities(id),
  rationale TEXT NOT NULL,
  evidence_ids TEXT NOT NULL CHECK(json_valid(evidence_ids) AND json_type(evidence_ids) = 'array'),
  outcome TEXT NOT NULL,
  CHECK(product_id IS NOT NULL OR opportunity_id IS NOT NULL)
);
INSERT INTO factory_decisions_v14(id,created_at,product_id,rationale,evidence_ids,outcome)
SELECT id,created_at,product_id,rationale,evidence_ids,outcome FROM factory_decisions;
DROP TABLE factory_decisions;
ALTER TABLE factory_decisions_v14 RENAME TO factory_decisions;
CREATE INDEX idx_factory_decisions_product ON factory_decisions(product_id,created_at,id);
CREATE INDEX idx_factory_decisions_opportunity ON factory_decisions(opportunity_id,created_at,id);
`;

// Company governance extends Evidence/Decision and shares the existing WAL connection.
export const MIGRATION_V15 = `
ALTER TABLE factory_evidence ADD COLUMN company_metadata TEXT CHECK(company_metadata IS NULL OR json_valid(company_metadata));
-- SQLite cannot widen the V14 CHECK constraint in place. Preserve all rows/indexes.
CREATE TABLE factory_decisions_v15 (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id))>0),created_at TEXT NOT NULL,
 product_id TEXT REFERENCES factory_products(id),opportunity_id TEXT REFERENCES factory_opportunities(id),
 rationale TEXT NOT NULL,evidence_ids TEXT NOT NULL CHECK(json_valid(evidence_ids) AND json_type(evidence_ids)='array'),outcome TEXT NOT NULL,
 company_address TEXT,company_metadata TEXT CHECK(company_metadata IS NULL OR json_valid(company_metadata)),
 CHECK(product_id IS NOT NULL OR opportunity_id IS NOT NULL OR company_address IS NOT NULL),
 CHECK(company_address IS NULL OR (company_metadata IS NOT NULL AND json_extract(company_metadata,'$.owner')=company_address))
);
INSERT INTO factory_decisions_v15(id,created_at,product_id,opportunity_id,rationale,evidence_ids,outcome) SELECT id,created_at,product_id,opportunity_id,rationale,evidence_ids,outcome FROM factory_decisions;
DROP TABLE factory_decisions;
ALTER TABLE factory_decisions_v15 RENAME TO factory_decisions;
CREATE INDEX idx_factory_decisions_product ON factory_decisions(product_id,created_at,id);
CREATE INDEX idx_factory_decisions_opportunity ON factory_decisions(opportunity_id,created_at,id);
CREATE INDEX idx_factory_decisions_company ON factory_decisions(company_address,created_at,id);
CREATE TABLE company_records (
  creator_address TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  content TEXT NOT NULL CHECK(json_valid(content)),
  content_hash TEXT NOT NULL,
  PRIMARY KEY(creator_address,kind,record_key,revision)
);
CREATE INDEX idx_company_records_scope ON company_records(creator_address,kind,record_key,revision);
CREATE TRIGGER company_records_no_update BEFORE UPDATE ON company_records BEGIN SELECT RAISE(ABORT,'Company history is immutable'); END;
CREATE TRIGGER company_records_no_delete BEFORE DELETE ON company_records BEGIN SELECT RAISE(ABORT,'Company history is immutable'); END;
CREATE TRIGGER company_records_no_replace BEFORE INSERT ON company_records WHEN EXISTS(SELECT 1 FROM company_records WHERE id=NEW.id OR (creator_address=NEW.creator_address AND kind=NEW.kind AND record_key=NEW.record_key AND revision=NEW.revision)) BEGIN SELECT RAISE(ABORT,'Company history is immutable'); END;
CREATE TRIGGER company_evidence_immutable BEFORE UPDATE ON factory_evidence WHEN OLD.company_metadata IS NOT NULL BEGIN SELECT RAISE(ABORT,'Evidence classification is immutable'); END;
CREATE TRIGGER company_evidence_no_delete BEFORE DELETE ON factory_evidence WHEN OLD.company_metadata IS NOT NULL BEGIN SELECT RAISE(ABORT,'Evidence history is immutable'); END;
CREATE TRIGGER company_evidence_no_replace BEFORE INSERT ON factory_evidence WHEN EXISTS(SELECT 1 FROM factory_evidence WHERE id=NEW.id AND company_metadata IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Evidence history is immutable'); END;
CREATE TRIGGER company_decision_immutable BEFORE UPDATE ON factory_decisions WHEN OLD.company_metadata IS NOT NULL BEGIN SELECT RAISE(ABORT,'Company decision is immutable'); END;
CREATE TRIGGER company_decision_no_delete BEFORE DELETE ON factory_decisions WHEN OLD.company_metadata IS NOT NULL BEGIN SELECT RAISE(ABORT,'Company decision is immutable'); END;
CREATE TRIGGER company_decision_no_replace BEFORE INSERT ON factory_decisions WHEN EXISTS(SELECT 1 FROM factory_decisions WHERE id=NEW.id AND company_metadata IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Company decision is immutable'); END;
`;

/** Indexed, minimized analytics observations on the existing SQLite database. */
export const MIGRATION_V16 = `
CREATE TABLE analytics_event_receipts (
 creator_address TEXT NOT NULL,provider_id TEXT NOT NULL,event_id TEXT NOT NULL,
 id TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES factory_products(id),occurred_at TEXT NOT NULL,nature TEXT NOT NULL,
 payload_hash TEXT NOT NULL,identity TEXT NOT NULL CHECK(json_valid(identity)),
 PRIMARY KEY(creator_address,provider_id,event_id)
);
CREATE INDEX idx_analytics_receipts_period ON analytics_event_receipts(creator_address,product_id,occurred_at);
CREATE INDEX idx_analytics_receipt_fact ON analytics_event_receipts(creator_address,provider_id,json_extract(identity,'$.economicMetric'),json_extract(identity,'$.receiptHash'));
CREATE TRIGGER analytics_receipts_no_update BEFORE UPDATE ON analytics_event_receipts BEGIN SELECT RAISE(ABORT,'Analytics dedup receipts immutable'); END;
CREATE TRIGGER analytics_receipts_no_delete BEFORE DELETE ON analytics_event_receipts BEGIN SELECT RAISE(ABORT,'Analytics dedup receipts retained'); END;
CREATE TRIGGER analytics_receipts_no_replace BEFORE INSERT ON analytics_event_receipts WHEN EXISTS(SELECT 1 FROM analytics_event_receipts WHERE creator_address=NEW.creator_address AND provider_id=NEW.provider_id AND event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'Analytics dedup receipts immutable'); END;
CREATE TABLE analytics_observations (
 creator_address TEXT NOT NULL, provider_id TEXT NOT NULL, event_id TEXT NOT NULL,
 id TEXT NOT NULL UNIQUE, product_id TEXT NOT NULL REFERENCES factory_products(id),
 occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, category TEXT NOT NULL,
 nature TEXT NOT NULL, payload_hash TEXT NOT NULL,
 content TEXT NOT NULL CHECK(json_valid(content)), content_hash TEXT NOT NULL,
 PRIMARY KEY(creator_address,provider_id,event_id)
);
CREATE INDEX idx_analytics_product_period ON analytics_observations(creator_address,product_id,occurred_at,id);
CREATE TRIGGER analytics_observations_no_update BEFORE UPDATE ON analytics_observations BEGIN SELECT RAISE(ABORT,'Analytics corrections require new events'); END;
CREATE TRIGGER analytics_observations_no_replace BEFORE INSERT ON analytics_observations WHEN EXISTS(SELECT 1 FROM analytics_observations WHERE id=NEW.id OR (creator_address=NEW.creator_address AND provider_id=NEW.provider_id AND event_id=NEW.event_id)) BEGIN SELECT RAISE(ABORT,'Analytics event identity is immutable'); END;
`;
