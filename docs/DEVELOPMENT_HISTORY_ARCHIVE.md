# Historical Browser Automation Patterns

Purpose:
Store previous discovered mechanisms.

Examples:
- CDP connection
- Target page discovery
- Selector fallback strategy
- Composer detection
- Send workflow

Restrictions:
- Reference only
- Not implementation truth
- Must be validated against current source

## DOM Discovery Pattern Used in Historical Example

### 1. Target Discovery Through Browser Context

The agent first connects to Chrome through CDP:
```
Chrome
  ↓
Remote debugging port
  ↓
Playwright connect_over_cdp()
  ↓
Browser contexts
  ↓
Pages/tabs
```

The example connects via `connect_over_cdp()` and iterates through browser contexts/pages to find the agent marker:
```python
for context in browser.contexts:
    for page in context.pages:
        text = page.text_content(timeout=1000)
        if "=== AGENT COMMAND START ===" in text:
            pages_with_marker.append(page)
```

### 2. DOM Selector Fallback Strategy

The example defines multiple selector groups for different DOM elements:

**Assistant message:**
```javascript
[
  '[data-message-author-role="assistant"]',
  'article[data-testid^="conversation-turn"] [data-message-author-role="assistant"]'
]
```

**Composer:**
```javascript
[
  '#prompt-textarea',
  '[data-testid="prompt-textarea"]',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]'
]
```

**Send button:**
```javascript
[
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]'
]
```

### 3. Metadata for Repository Feature

This pattern is preserved as historical reference with metadata:
```json
{
  "type": "historical_reference",
  "area": "browser_dom_discovery",
  "authority": "reference_only",
  "can_influence_design": true,
  "can_override_runtime": false
}
```