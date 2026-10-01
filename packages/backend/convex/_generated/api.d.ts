/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as browse from "../browse.js";
import type * as captures from "../captures.js";
import type * as crons from "../crons.js";
import type * as design_systems from "../design_systems.js";
import type * as helpers from "../helpers.js";
import type * as lib_ai_config from "../lib/ai_config.js";
import type * as lib_capture_stats from "../lib/capture_stats.js";
import type * as lib_capture_text from "../lib/capture_text.js";
import type * as lib_color from "../lib/color.js";
import type * as lib_design_system_builders from "../lib/design_system/builders.js";
import type * as lib_design_system_colors from "../lib/design_system/colors.js";
import type * as lib_design_system_contrast from "../lib/design_system/contrast.js";
import type * as lib_design_system_describe from "../lib/design_system/describe.js";
import type * as lib_design_system_generate from "../lib/design_system/generate.js";
import type * as lib_design_system_metrics from "../lib/design_system/metrics.js";
import type * as lib_design_system_oklch from "../lib/design_system/oklch.js";
import type * as lib_design_system_scale from "../lib/design_system/scale.js";
import type * as lib_design_system_types from "../lib/design_system/types.js";
import type * as lib_design_system_typography from "../lib/design_system/typography.js";
import type * as lib_design_system_validate from "../lib/design_system/validate.js";
import type * as lib_design_system_validators from "../lib/design_system_validators.js";
import type * as lib_read_budget from "../lib/read_budget.js";
import type * as lib_search_filters from "../lib/search_filters.js";
import type * as lib_search_rank from "../lib/search_rank.js";
import type * as link_search from "../link_search.js";
import type * as links from "../links.js";
import type * as local_ai from "../local_ai.js";
import type * as search from "../search.js";
import type * as search_scope from "../search_scope.js";
import type * as sessions from "../sessions.js";
import type * as upload from "../upload.js";
import type * as user_stats from "../user_stats.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  browse: typeof browse;
  captures: typeof captures;
  crons: typeof crons;
  design_systems: typeof design_systems;
  helpers: typeof helpers;
  "lib/ai_config": typeof lib_ai_config;
  "lib/capture_stats": typeof lib_capture_stats;
  "lib/capture_text": typeof lib_capture_text;
  "lib/color": typeof lib_color;
  "lib/design_system/builders": typeof lib_design_system_builders;
  "lib/design_system/colors": typeof lib_design_system_colors;
  "lib/design_system/contrast": typeof lib_design_system_contrast;
  "lib/design_system/describe": typeof lib_design_system_describe;
  "lib/design_system/generate": typeof lib_design_system_generate;
  "lib/design_system/metrics": typeof lib_design_system_metrics;
  "lib/design_system/oklch": typeof lib_design_system_oklch;
  "lib/design_system/scale": typeof lib_design_system_scale;
  "lib/design_system/types": typeof lib_design_system_types;
  "lib/design_system/typography": typeof lib_design_system_typography;
  "lib/design_system/validate": typeof lib_design_system_validate;
  "lib/design_system_validators": typeof lib_design_system_validators;
  "lib/read_budget": typeof lib_read_budget;
  "lib/search_filters": typeof lib_search_filters;
  "lib/search_rank": typeof lib_search_rank;
  link_search: typeof link_search;
  links: typeof links;
  local_ai: typeof local_ai;
  search: typeof search;
  search_scope: typeof search_scope;
  sessions: typeof sessions;
  upload: typeof upload;
  user_stats: typeof user_stats;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
