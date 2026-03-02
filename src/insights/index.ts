// Insights Engine Module
// Main barrel file - re-exports public API
//
// This module provides AI-powered business insights, compliance tips,
// and actionable recommendations for Nigerian SMEs. It aggregates data
// from transactions, business profiles, and AI services to generate
// personalized, timely insights.
//
// Submodules:
// - types/       — Core type definitions and interfaces
// - analyzers/   — Category-specific insight analyzers (tax, cashflow, spending, etc.)
// - services/    — Business logic (generator, scorer, lifecycle, scheduler, templates)
// - repositories/ — Data access layer (insights, templates, preferences, analytics)

export * from './types/index.js';
export * from './analyzers/index.js';
export * from './services/index.js';
export * from './repositories/index.js';
export * from './controllers/index.js';
