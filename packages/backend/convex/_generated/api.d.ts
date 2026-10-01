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
import type * as ai from "../ai.js";
import type * as browse from "../browse.js";
import type * as captures from "../captures.js";
import type * as helpers from "../helpers.js";
import type * as lib_ai_config from "../lib/ai_config.js";
import type * as lib_color from "../lib/color.js";
import type * as lib_search_filters from "../lib/search_filters.js";
import type * as lib_search_rank from "../lib/search_rank.js";
import type * as link_search from "../link_search.js";
import type * as links from "../links.js";
import type * as local_ai from "../local_ai.js";
import type * as search from "../search.js";
import type * as search_scope from "../search_scope.js";
import type * as sessions from "../sessions.js";
import type * as upload from "../upload.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  browse: typeof browse;
  captures: typeof captures;
  helpers: typeof helpers;
  "lib/ai_config": typeof lib_ai_config;
  "lib/color": typeof lib_color;
  "lib/search_filters": typeof lib_search_filters;
  "lib/search_rank": typeof lib_search_rank;
  link_search: typeof link_search;
  links: typeof links;
  local_ai: typeof local_ai;
  search: typeof search;
  search_scope: typeof search_scope;
  sessions: typeof sessions;
  upload: typeof upload;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
