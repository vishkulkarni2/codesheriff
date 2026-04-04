# Quick Wins: Top 10 Catchable Golden Comments + Proposed Rules

These golden comments we are currently missing could be caught with
targeted semgrep rules, prompt tweaks, or simple pattern matching.

## Top 10 Most Catchable Misses

### 1. [High/api_misuse] sentry-greptile (Python)
- **PR**: https://github.com/ai-code-review-evaluation/sentry-greptile/pull/1
- **Comment**: Django querysets do not support negative slicing
- **Catchability score**: 9

### 2. [High/null_reference] grafana (Go)
- **PR**: https://github.com/grafana/grafana/pull/90939
- **Comment**: In addition to the missing double-check, the function has a critical flaw in its error handling: it unconditionally assigns the fetch result to the cache (line 69: entryPointAssetsCache = result) rega
- **Catchability score**: 8

### 3. [Critical/null_reference] keycloak (Java)
- **PR**: https://github.com/keycloak/keycloak/pull/40940
- **Comment**: Returning null from getSubGroupsCount() violates the GroupModel contract (Javadoc says it never returns null) and may lead to NPEs in callers that expect a non-null count.
- **Catchability score**: 7

### 4. [Medium/type_error] sentry (Python)
- **PR**: https://github.com/getsentry/sentry/pull/77754
- **Comment**: to_dict() returns a datetime for queued; if this dict is passed in task kwargs (e.g., via apply_async), JSON serialization may fail depending on the serializer, which can cause enqueue errors.
- **Catchability score**: 7

### 5. [High/type_error] sentry-greptile (Python)
- **PR**: https://github.com/ai-code-review-evaluation/sentry-greptile/pull/2
- **Comment**: OptimizedCursorPaginator.get_item_key uses floor/ceil on a datetime key (order_by='-datetime'), causing TypeError.
- **Catchability score**: 7

### 6. [Critical/null_reference] discourse-graphite (Ruby)
- **PR**: https://github.com/ai-code-review-evaluation/discourse-graphite/pull/10
- **Comment**: NoMethodError before_validation in EmbeddableHost
- **Catchability score**: 7

### 7. [Medium/null_reference] discourse-graphite (Ruby)
- **PR**: https://github.com/ai-code-review-evaluation/discourse-graphite/pull/10
- **Comment**: The update and destroy methods in Admin::EmbeddableHostsController do not validate the existence of the EmbeddableHost record retrieved by ID. If EmbeddableHost.where(id: params[:id]).first returns ni
- **Catchability score**: 7

### 8. [High/logic_error] cal.com (TypeScript)
- **PR**: https://github.com/calcom/cal.com/pull/10967
- **Comment**: Logic error: when externalCalendarId is provided, you're searching for a calendar where externalId === externalCalendarId, but this will always fail since you're looking for a calendar that matches it
- **Catchability score**: 7

### 9. [High/type_error] sentry (Python)
- **PR**: https://github.com/getsentry/sentry/pull/93824
- **Comment**: Because flusher processes are created via multiprocessing.get_context('spawn').Process, they are instances of multiprocessing.context.SpawnProcess, which on POSIX is not a subclass of multiprocessing.
- **Catchability score**: 6

### 10. [High/null_reference] sentry-greptile (Python)
- **PR**: https://github.com/ai-code-review-evaluation/sentry-greptile/pull/1
- **Comment**: When requests are authenticated with API keys or org auth tokens (which have user_id=None), organization_context.member is None. Line 71 attempts to access organization_context.member.has_global_acces
- **Catchability score**: 6

---

## Proposed Semgrep Rules

### Rule: Async callbacks in forEach
Languages: typescript, javascript | Severity: WARNING

```yaml
rules:
  - id: async-callback-in-foreach
    patterns:
      - pattern: $ARRAY.forEach(async ($PARAM) => { ... })
    message: >
      Async callbacks in forEach are not awaited. Use for...of with await,
      or Promise.all() with .map() instead.
    languages: [typescript, javascript]
    severity: WARNING
```

### Rule: dayjs/moment reference comparison
Languages: typescript, javascript | Severity: ERROR

```yaml
rules:
  - id: dayjs-reference-equality
    patterns:
      - pattern: dayjs(...) === dayjs(...)
      - pattern: dayjs(...) == dayjs(...)
    message: >
      dayjs objects should be compared with .isSame(), not === which compares
      object references and always returns false.
    languages: [typescript, javascript]
    severity: ERROR
```

### Rule: Java Optional.get() without isPresent()
Languages: java | Severity: ERROR

```yaml
rules:
  - id: optional-get-without-ispresent
    patterns:
      - pattern: $OPT.get()
      - pattern-not-inside: |
          if ($OPT.isPresent()) { ... }
    message: >
      Calling Optional.get() without checking isPresent() can throw
      NoSuchElementException. Use orElse(), orElseGet(), or check isPresent().
    languages: [java]
    severity: ERROR
```

### Rule: AND vs OR in permission checks
Languages: typescript, javascript | Severity: WARNING

```yaml
rules:
  - id: suspicious-and-permission-check
    patterns:
      - pattern: $A && $B
      - metavariable-regex:
          metavariable: $A
          regex: .*(isAdmin|isOwner|isManager|hasRole|hasPermission).*
      - metavariable-regex:
          metavariable: $B
          regex: .*(isAdmin|isOwner|isManager|hasRole|hasPermission).*
    message: >
      Suspicious AND (&&) between permission checks. Did you mean OR (||)?
      Requiring BOTH admin AND owner is usually incorrect.
    languages: [typescript, javascript]
    severity: WARNING
```

### Rule: System.exit() / picocli.exit() in library code
Languages: java | Severity: WARNING

```yaml
rules:
  - id: system-exit-in-lib
    patterns:
      - pattern: System.exit(...)
    message: >
      System.exit() terminates the JVM. Throw an exception or return an
      exit code instead.
    languages: [java]
    severity: WARNING
  - id: picocli-exit-misuse
    patterns:
      - pattern: picocli.exit(...)
    message: >
      picocli.exit() calls System.exit(). Use CommandLine.ExitCode instead.
    languages: [java]
    severity: WARNING
```

### Rule: Django queryset negative slicing
Languages: python | Severity: ERROR

```yaml
rules:
  - id: django-negative-slice
    patterns:
      - pattern: $QS[-$N:]
    message: >
      Django QuerySets do not support negative indexing. Use .reverse()[:N]
      or order_by() with positive slicing instead.
    languages: [python]
    severity: ERROR
```

### Rule: Insecure origin validation with indexOf
Languages: typescript, javascript | Severity: ERROR

```yaml
rules:
  - id: insecure-origin-check
    patterns:
      - pattern: $STR.indexOf($ORIGIN)
    message: >
      Using indexOf for origin/URL validation is insecure. evil-example.com
      passes checks for example.com. Use URL parsing with exact hostname match.
    languages: [typescript, javascript]
    severity: ERROR
```

### Rule: Mutable default arguments (Python)
Languages: python | Severity: WARNING

```yaml
rules:
  - id: mutable-default-arg
    patterns:
      - pattern: |
          def $FUNC(..., $PARAM=[], ...):
              ...
      - pattern: |
          def $FUNC(..., $PARAM={}, ...):
              ...
    message: >
      Mutable default argument. Default mutable objects are shared between
      calls. Use None and initialize inside the function.
    languages: [python]
    severity: WARNING
```

---

## Prompt Tweaks for LLM Detectors

### LogicBugDetector - Null Safety Focus
Add to system prompt:
```
Pay special attention to method calls on variables that could be nil/null/None.
Look for patterns where:
- A variable is assigned from a lookup/find/query that may return nil
- The variable is used immediately without a nil check
- Especially: .first, .find, .get, .where().first, dictionary lookups
- Optional.get() called without isPresent() check
- Contract violations: method returns null when docs say non-null
```

### LogicBugDetector - API Misuse Focus
Add to system prompt:
```
Check for common API misuse patterns:
- Django: negative queryset slicing, unsupported ORM operations
- Python: mutable default arguments in functions/dataclasses
- Java: Optional.get() without isPresent(), System.exit() in libraries
- TypeScript: async callbacks in forEach (never awaited)
- Go: incomplete double-checked locking, map access without sync
```

## Precision Fix: Finding Cap

The single most impactful change for precision is capping findings per PR.

```python
# After all detectors run, sort by confidence and cap
MAX_FINDINGS_PER_PR = 5
findings.sort(key=lambda f: f.confidence, reverse=True)
findings = findings[:MAX_FINDINGS_PER_PR]

# Also filter common FP patterns
FP_BLOCKLIST = [
    'optional chaining',
    'consider adding error handling',
    'consider adding validation',
    'authorization check',
]
findings = [f for f in findings
            if not any(p in f.text.lower() for p in FP_BLOCKLIST)]
```
