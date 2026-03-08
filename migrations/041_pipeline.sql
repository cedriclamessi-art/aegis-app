-- ============================================================================
-- Migration 041: Pipeline System
-- AEGIS v7.0
-- ============================================================================
-- Creates the tables needed for the multi-step pipeline orchestration system.
-- Each pipeline run tracks a product through sequential processing steps,
-- with full step-level logging for observability and retry support.
-- ============================================================================

-- Pipeline runs table
-- Tracks each pipeline execution from start to completion/failure.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL,
  product_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','paused')),
  current_step INTEGER NOT NULL DEFAULT 0,
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_shop ON pipeline_runs(shop_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

-- Pipeline step logs
-- Captures granular events for each step within a pipeline run.
-- Enables debugging, auditing, and performance analysis.
CREATE TABLE IF NOT EXISTS pipeline_step_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipeline_runs(id),
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  event TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_pipeline ON pipeline_step_logs(pipeline_id);
