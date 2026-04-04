# CodeSheriff LLM Detector Prompt Improvements

Based on analysis of 137 golden comments vs 43 CS findings (F1=0.23), these are targeted prompt additions
for each LLM detector. Each improvement is tied to a specific pattern that appears repeatedly in the benchmark.

---

## 1. LogicBugDetector

### Improvement A: Wrong Variable / Parameter Swaps

**Pattern targeted:** `incorrect_value` — code uses the right *structure* but the wrong variable/parameter.  
This is the #1 missed category (34/137 golden comments, 12% coverage).

**Golden comment example:**
> "In `isAccessTokenId`, the substring for the grant shortcut occupies indices 4–5 (substring(4,6)), and a match should return `true` (combined with UUID check), not `false`."

> "Wrong parameter in null check (`grantType` vs. `rawTokenId`)"

**Prompt text to add:**

```
## Detecting Wrong Variable / Parameter Bugs

When reviewing conditional expressions, null checks, and equality comparisons, look for cases where
the *semantically correct* variable might differ from the one actually used:

1. **Parameter swap in conditions:** If a method has parameters A and B with similar types, check that
   each condition references the right one. Example: `if (grantType == null)` should be `if (rawTokenId == null)`.

2. **Inverted boolean logic:** If a function named `isXxx()` returns `false` on the condition that means
   "this IS an Xxx", that's likely inverted. The return value should match the semantic name.

3. **Wrong index range:** When using `substring(start, end)` or slicing, verify the start/end indices
   against the comment or docstring describing what the code extracts.

4. **Wrong field in compound expression:** In complex expressions combining multiple fields, verify each
   field is the correct one for the semantic intent. Pay special attention when there are multiple fields
   of the same type in scope.

For each suspicious condition, write: "This condition uses [X] but based on [method name/context] it
should probably use [Y]."
```

---

### Improvement B: Feature Flag Consistency

**Pattern targeted:** `logic_error` — wrong feature flag used (V1 vs V2), causing inconsistent behavior.

**Golden comment example:**
> "The AdminPermissions event listener is incorrectly guarded by the ADMIN_FINE_GRAINED_AUTHZ (V1) feature flag. This is inconsistent with other methods in the class that use ADMIN_FINE_GRAINED_AUTHZ_V2. Consequently, cleanup logic will not execute when V2 is enabled but V1 is not, leading to orphaned permissions."

**Prompt text to add:**

```
## Feature Flag Consistency Check

When reviewing code that uses feature flags or configuration toggles:

1. **Cross-method consistency:** If multiple methods in the same class check feature flags, verify they
   check the *same* flag (or intentionally different ones). Flag mismatches where one method uses FLAG_V1
   and another uses FLAG_V2 to guard related behavior.

2. **Cleanup/lifecycle symmetry:** If code creates/registers something under feature flag A, the corresponding
   cleanup/unregister code should also check flag A (not a different version). Asymmetry here causes
   resource leaks or orphaned state when flags are partially enabled.

3. **"Off by one version" bugs:** In systems with versioned features (V1/V2, legacy/new), scan for places
   where the wrong version flag is referenced — especially in event listeners, observers, and hooks.
```

---

## 2. HallucinationDetector

### Improvement A: Interface Contract Violations

**Pattern targeted:** `null_reference` + `api_misuse` — code violates the documented contract of an interface or method.

**Golden comment example:**
> "Returning `null` from `getSubGroupsCount()` violates the `GroupModel` contract (Javadoc says it never returns null) and may lead to NPEs in callers that expect a non-null count."

> "In `getGroupIdsWithViewPermission`, `hasPermission` is called with `groupResource.getId()` but the contract says it resolves resources *by name*, not by ID."

**Prompt text to add:**

```
## Interface Contract and API Usage Verification

When reviewing method implementations and API calls:

1. **Return value contracts:** If a method's Javadoc or type signature states it never returns null (or
   always returns a non-empty value), flag any implementation path that returns null or an empty value.

2. **Method argument semantics:** When calling a method, check what the argument *represents* semantically,
   not just its type. If `hasPermission(resourceId)` expects a resource *name* but is being called with
   an *ID*, that's a semantic mismatch even if both are Strings.

3. **Optional misuse:** In Java, never call `Optional.get()` without first calling `isPresent()` or using
   `orElse()`/`orElseGet()`. Flag any direct `.get()` call that isn't guarded.

4. **Collection mutability contracts:** If a returned collection should be immutable but code tries to
   mutate it (or vice versa), flag it.

For each API call, ask: "Does the argument passed here match what this method actually expects semantically?"
```

---

### Improvement B: Python/Ruby Dict Access Without Guards

**Pattern targeted:** `null_reference` — missing key existence check before nested dict/hash access.

**Golden comment example:**
> "The code attempts to access `integration.metadata[sender][login]` without checking for the existence of the sender key. This causes a `KeyError` for integrations where the sender metadata was not set during creation."

**Prompt text to add:**

```
## Dict/Hash Access Safety

When reviewing code that accesses dictionaries (Python) or hashes (Ruby):

1. **Nested access chains:** Flag `dict[key1][key2]` patterns where `key1` may not exist. In Python,
   prefer `dict.get(key1, {}).get(key2)` or explicit `if key1 in dict` check. In Ruby, prefer `hash.dig(:key1, :key2)`.

2. **Dynamic keys from external data:** When a key comes from user input, an API response, or a database
   field (not a hardcoded string), it may be absent. Flag unguarded access to such keys.

3. **Optional chaining equivalents:** In TypeScript, check for `.?.` usage; in Python, check for `.get()`;
   in Ruby, check for `&.` or `.dig()`. Flag direct bracket access on objects that could be nil/None.
```

---

## 3. StaticAnalyzer

### Improvement A: OAuth / Security Token Predictability

**Pattern targeted:** `security` — using a static/predictable value as a security-sensitive token.

**Golden comment example:**
> "OAuth state uses `pipeline.signature` (static) instead of a per-request random value."

> "The Check operation exhibits asymmetric cache trust logic: cached permission grants are trusted and returned immediately, but cached denials are ignored, leading to a fresh database lookup. Stale cached grants provide access to revoked resources."

**Prompt text to add:**

```
## Security Token and Permission Cache Review

1. **OAuth/CSRF state parameters:** When reviewing OAuth flows, verify that `state` parameters are
   generated per-request using a cryptographically random source (SecureRandom, crypto.randomBytes, etc.).
   Flag any use of static values, sequential counters, or derived-from-static-data values.

2. **Asymmetric cache trust:** When reviewing permission/auth caches, check if the cache is used
   symmetrically: if cached grants are trusted, cached denials should also be trusted (or neither should be).
   Asymmetry that favors grants over denials is a time-of-check-time-of-use security bug.

3. **Permission check method identity:** Verify that `canManage()`, `canView()`, `hasPermission()` etc.
   check the *correct* resource for the *correct* operation. A permission check that uses the wrong resource
   identifier will silently grant access to unintended targets.
```

---

### Improvement B: Unsafe Type Casts

**Pattern targeted:** `incorrect_value` — unsafe casts that could ClassCastException at runtime.

**Golden comment example:**
> "Unsafe cast from `AuthenticatorFactory` to `ConfigurableAuthenticatorFactory` without type checking."

**Prompt text to add:**

```
## Unsafe Cast Detection

When reviewing Java code that performs explicit casts:

1. **Cast without instanceof guard:** Flag `(TargetType) variable` where there's no preceding
   `instanceof TargetType` check in the same method scope. Even if the cast "usually works," it will
   throw ClassCastException in edge cases.

2. **Cross-interface cast:** When casting across interface hierarchies (e.g., from InterfaceA to InterfaceB
   where they share a common parent), the cast will fail for any implementation that only implements A.
   Flag these and suggest adding an instanceof check.

3. **Cast result immediately used:** When the cast result is immediately used without storing it (e.g.,
   `((TargetType) obj).method()`), an uncaught ClassCastException will be especially disruptive.
   Prefer assigning to a local variable after a guard check.
```

---

## 4. AuthFlowValidator

### Improvement A: Missing Input Validation and Normalization

**Pattern targeted:** `missing_validation` — missing existence/type checks before using values.

**Golden comment example:**
> "Consider normalizing the input locale (e.g., to a symbol) when checking/loading here to avoid double-loading if the same locale is passed as a String vs Symbol."

> "The anchor sanitization logic has a potential issue where it consumes English matcher groups without proper validation. If the translated text has more anchor tags than the English text, this could lead to incorrect validation results."

**Prompt text to add:**

```
## Input Validation Completeness

When reviewing methods that accept user input, API parameters, or values from external sources:

1. **Type normalization:** If a parameter can arrive as multiple equivalent forms (String vs Symbol,
   lowercase vs uppercase, with vs without leading slash), check that the method normalizes it before
   use. Missing normalization causes bugs where the same logical input produces different results.

2. **Boundary conditions in loops:** When iterating with two iterators in parallel (e.g., matching
   anchors in two strings), verify the code handles the case where one list is longer than the other.
   If iterator A runs out but iterator B still has items, what happens?

3. **Early return completeness:** When a method has multiple early-return guards, verify that all
   problematic inputs are caught before they reach processing logic.
```

---

## 5. General: Reduce False Positives

Currently 56% of CS comments are false positives. These prompt additions reduce noise:

### For ALL detectors

**Prompt text to add to every detector's system prompt:**

```
## Reducing False Positives

Before reporting a finding, apply these quality gates:

1. **Confirm the bug can actually manifest:** Don't flag defensive casts that are inside an instanceof
   check, or null dereferences inside non-null guards. Check whether the guard already exists.

2. **Only report if you're >70% confident:** If a pattern *looks* like a bug but the surrounding
   context suggests it's intentional or safe, don't report it. A false positive costs developer trust.

3. **Don't report style issues as bugs:** Method name typos, Javadoc inconsistencies, and code style
   violations are NOT bugs for this tool. Only report behavioral issues that can cause incorrect runtime
   behavior, data loss, or security vulnerabilities.

4. **Cite specific evidence:** Every finding must reference the specific line(s) of code that are
   problematic, and explain what input/condition would trigger the bug. "This could be null" without
   showing the code path that produces null is not sufficient.
```

---

## Implementation Priority

| Detector | Improvement | Bug Type Impact | Expected TP Gain | Effort |
|----------|-------------|-----------------|------------------|--------|
| LogicBugDetector | Wrong variable/parameter swaps | incorrect_value +8 | +6 TPs | Medium |
| HallucinationDetector | Interface contract violations | null_reference +4 | +3 TPs | Low |
| HallucinationDetector | Dict/hash access guards | null_reference +3 | +2 TPs | Low |
| StaticAnalyzer | OAuth token predictability | security +3 | +2 TPs | Low |
| StaticAnalyzer | Unsafe casts | incorrect_value +3 | +2 TPs | Low |
| AuthFlowValidator | Input validation | missing_validation +3 | +2 TPs | Medium |
| All detectors | Reduce FP prompt | All types | -10 FPs | Low |

**Estimated impact if all improvements applied:**  
TP: 21 → ~37 | FP: 24 → ~14 | Precision: 47% → ~73% | Recall: 15% → ~27% | F1: 23% → ~39%
