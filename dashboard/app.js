'use strict';

const $ = id => document.getElementById(id);
let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname);
let tools = [];
let selected;
let category = 'All capabilities';
let busy = false;
let pendingConfirmation;
const controls = new Map();
const families = ['All capabilities', 'Rooms & messages', 'Identity & trust', 'Consensus & governance', 'Atlas & verification', 'System'];

function family(name) {
  if (/^chat\.(room|rooms|message|history)/.test(name)) return 'Rooms & messages';
  if (/^chat\.(auth|buddy)/.test(name)) return 'Identity & trust';
  if (name === 'chat_cast_vote' || name === 'acr_request_human_gate') return 'Consensus & governance';
  if (/^acr_.*dag|^mcp_ast/.test(name)) return 'Atlas & verification';
  return 'System';
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

async function api(route, input) {
  const response = await fetch(route, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function call(name, args = {}) {
  const result = await api('/api/call', { name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(data.error || 'Tool execution failed.');
  return data;
}

function navigation() {
  $('categories').replaceChildren(...families.map(label => {
    const button = element('button', undefined, 'nav-item');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(category === label));
    button.append(element('span', label), element('span', String(tools.filter(tool => label === families[0] || family(tool.name) === label).length), 'nav-count'));
    button.addEventListener('click', () => {
      if (busy || !tool) return;
      category = label;
      $('tool-search').value = '';
      navigation();
      toolList();
      $('tool-search').focus();
    });
    return button;
  }));
}

function toolList() {
  const search = $('tool-search').value.trim().toLowerCase();
  const matches = tools.filter(tool =>
    (category === families[0] || family(tool.name) === category) &&
    `${tool.name} ${tool.description}`.toLowerCase().includes(search));
  $('tool-list').replaceChildren(...matches.map(tool => {
    const button = element('button', tool.name, 'tool-choice');
    button.type = 'button';
    button.disabled = busy;
    button.setAttribute('aria-pressed', String(selected?.name === tool.name));
    button.addEventListener('click', () => selectTool(tool, {}, true));
    return button;
  }));
  if (!matches.length) $('tool-list').append(element('p', 'No matching tools.', 'field-help'));
}

function selectTool(tool, values = {}, focus = false) {
  if (busy) return;
  selected = tool;
  controls.clear();
  $('fields').replaceChildren();
  $('tool-title').textContent = tool.name;
  $('tool-family').textContent = family(tool.name);
  $('tool-description').textContent = tool.description;
  $('tool-kind').textContent = tool.annotations.readOnlyHint ? 'READ ONLY / LOCAL' : 'REFERENCE MUTATION';
  $('result').textContent = 'Ready. Run this tool to inspect its actual result.';
  $('result-state').textContent = 'IDLE';
  $('result-summary').textContent = 'Results come directly from the shared MCP dispatcher.';
  $('result').closest('.panel').classList.remove('error');
  $('dashboard-link').hidden = true;
  $('dashboard-link').removeAttribute('href');
  for (const [name, spec] of Object.entries(tool.inputSchema.properties)) {
    const required = (tool.inputSchema.required || []).includes(name);
    const wrapper = element('div', undefined, 'field');
    const heading = element('div', undefined, 'field-heading');
    const label = element('label', name);
    label.htmlFor = `arg-${name}`;
    if (required) label.append(element('span', 'REQUIRED', 'required'));
    heading.append(label);
    let control;
    if (spec.enum || spec.type === 'boolean') {
      control = element('select');
      const options = spec.enum || ['true', 'false'];
      for (const value of options) {
        const option = element('option', value);
        option.value = value;
        control.append(option);
      }
    } else {
      control = element(['object', 'array'].includes(spec.type) || /content|output|rationale|description|signature/.test(name) ? 'textarea' : 'input');
      if (control.tagName === 'INPUT') {
        control.type = spec.type === 'number' ? 'number' : 'text';
        if (spec.type === 'number') control.step = 'any';
      }
      if (spec.type === 'string') control.maxLength = 65536;
      if (spec.type === 'object') control.placeholder = '{}';
      if (spec.type === 'array') control.placeholder = '["chat.basic"]';
    }
    control.id = `arg-${name}`;
    control.name = name;
    control.required = required && spec.type !== 'string';
    control.autocomplete = 'off';
    control.spellcheck = false;
    let include;
    if (!required) {
      const includeLabel = element('label', undefined, 'include-label');
      include = element('input');
      include.type = 'checkbox';
      include.checked = Object.hasOwn(values, name);
      include.setAttribute('aria-label', `Include ${name}`);
      control.disabled = !include.checked;
      include.addEventListener('change', () => { control.disabled = !include.checked; });
      includeLabel.append(include, document.createTextNode('Include'));
      heading.append(includeLabel);
    }
    if (Object.hasOwn(values, name)) {
      control.value = ['object', 'array'].includes(spec.type) ? JSON.stringify(values[name], null, 2) : String(values[name]);
    }
    const help = element('p', `${spec.description || ''}${['object', 'array'].includes(spec.type) ? ' Enter valid JSON.' : ''}`, 'field-help');
    help.id = `help-${name}`;
    control.setAttribute('aria-describedby', help.id);
    wrapper.append(heading, control, help);
    $('fields').append(wrapper);
    controls.set(name, { control, spec, include });
  }
  if (!controls.size) $('fields').append(element('p', 'No arguments required.', 'field-help'));
  $('run').disabled = false;
  toolList();
  if (focus) {
    $('workspace').scrollIntoView({ block: 'start' });
    const target = $('fields').querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || $('run');
    target.focus({ preventScroll: true });
  }
}

function readArguments() {
  const args = {};
  for (const [name, { control, spec, include }] of controls) {
    if (include && !include.checked) continue;
    let value = control.value;
    if (['array', 'object'].includes(spec.type)) {
      try { value = JSON.parse(value); } catch (err) { throw new Error(`${name}: enter valid JSON.`); }
      if (spec.type === 'array' ? !Array.isArray(value) : value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name}: expected a JSON ${spec.type}.`);
      }
    }
    if (spec.type === 'number') {
      if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`${name}: enter a finite number.`);
      value = Number(value);
    }
    if (spec.type === 'boolean') value = value === 'true';
    args[name] = value;
  }
  return args;
}

function setBusy(value) {
  busy = value;
  $('run').disabled = value || !selected;
  $('run').textContent = value ? 'Executing...' : 'Run tool \u2197';
  $('refresh').disabled = value;
  $('tool-form').setAttribute('aria-busy', String(value));
  toolList();
}

function resultError(err) {
  $('result').textContent = err.message;
  $('result-state').textContent = 'ERROR';
  $('result-summary').textContent = 'The action did not return a successful tool result.';
  $('result').closest('.panel').classList.add('error');
  status(err.message, true);
}

function confirmMutation(name, args) {
  $('confirm-args').textContent = JSON.stringify({ name, arguments: args }, null, 2);
  $('confirmation').showModal();
  $('cancel').focus();
  return new Promise(resolve => { pendingConfirmation = resolve; });
}

function finishConfirmation(approved) {
  $('confirmation').close();
  pendingConfirmation?.(approved);
  pendingConfirmation = undefined;
  $('confirm-args').textContent = '';
}

async function runTool(event) {
  event.preventDefault();
  if (busy || !selected) return;
  let args;
  try { args = readArguments(); } catch (err) { resultError(err); return; }
  const tool = selected;
  setBusy(true);
  try {
    if (!tool.annotations.readOnlyHint && !await confirmMutation(tool.name, args)) {
      status('Local change cancelled. No tool was called.');
      return;
    }
    status(`Executing ${tool.name}...`);
    const data = await call(tool.name, args);
    if (tool.name === 'chat.dashboard.open') {
      const url = new URL(data.url);
      if (url.origin !== location.origin) throw new Error('Dashboard returned an unexpected origin.');
      $('dashboard-link').href = url.href;
      $('dashboard-link').target = '_blank';
      $('dashboard-link').rel = 'noopener noreferrer';
      $('dashboard-link').hidden = false;
    }
    const visible = { ...data };
    if (data.session_token) visible.session_token = '[reference token redacted; not used for authorization]';
    if (tool.name === 'chat.dashboard.open') visible.url = '[capability URL available through the link below]';
    $('result').textContent = JSON.stringify(Array.isArray(data) ? data : visible, null, 2);
    $('result-state').textContent = 'COMPLETE';
    $('result-summary').textContent = `${tool.name} returned a local reference result.`;
    $('result').closest('.panel').classList.remove('error');
    if (tool.name === 'chat.auth.verify') {
      for (const name of ['nonce', 'signature']) if (controls.has(name)) controls.get(name).control.value = '';
    }
    status(`${tool.name} completed.`);
    await refreshOverview(false);
  } catch (err) {
    resultError(err);
  } finally {
    setBusy(false);
    if (document.activeElement === document.body) $('run').focus({ preventScroll: true });
  }
}

async function refreshOverview(announce = true) {
  $('refresh').disabled = true;
  try {
    const [health, rooms, dag] = await Promise.all([
      call('chat.health'), call('chat.rooms.list'), call('acr_get_dag_state')
    ]);
    $('connection').textContent = 'Reference connected';
    $('room-count').textContent = String(health.active_rooms);
    $('tool-count').textContent = String(tools.length);
    $('dag-count').textContent = `${dag.nodes.filter(node => node.state === 'COMPLETED').length}/${dag.nodes.length}`;
    $('rooms').replaceChildren(...rooms.slice(0, 5).map(room => {
      const row = element('div', undefined, 'room-row');
      const info = element('div', undefined, 'room-info');
      info.append(element('strong', room.name), element('p', `${room.topic} / ${room.member_count} present${room.is_private ? ' / private flag only' : ''}`));
      const button = element('button', 'History', 'text-button');
      button.type = 'button';
      button.setAttribute('aria-label', `History for ${room.name}`);
      button.addEventListener('click', () => selectTool(tools.find(tool => tool.name === 'chat.history.fetch'), { room_id: room.id }, true));
      row.append(element('span', '#', 'room-icon'), info, button);
      return row;
    }));
    if (rooms.length > 5) $('rooms').append(element('p', `${rooms.length - 5} more rooms. Use Inspect rooms for the full list.`, 'field-help'));
    $('dag').replaceChildren(...dag.nodes.map(node => {
      const card = element('div', undefined, `dag-node${node.state === 'COMPLETED' ? ' completed' : ''}`);
      card.append(element('strong', node.id), element('small', node.state.replaceAll('_', ' ')));
      return card;
    }));
    if (announce) status('Overview refreshed from the shared reference process.');
  } catch (err) {
    $('connection').textContent = 'Overview unavailable';
    status(`Overview refresh failed: ${err.message}. Displayed values may be stale.`, true);
  } finally {
    $('refresh').disabled = busy;
  }
}

$('tool-search').addEventListener('input', toolList);
$('tool-form').addEventListener('submit', runTool);
$('refresh').addEventListener('click', () => refreshOverview());
$('confirm').addEventListener('click', () => finishConfirmation(true));
$('cancel').addEventListener('click', () => finishConfirmation(false));
$('confirmation').addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
$('confirmation').addEventListener('close', () => {
  if (!busy) $('run').focus({ preventScroll: true });
});
$('inspect-rooms').addEventListener('click', () => selectTool(tools.find(tool => tool.name === 'chat.rooms.list'), {}, true));
$('inspect-dag').addEventListener('click', () => selectTool(tools.find(tool => tool.name === 'acr_get_dag_state'), {}, true));
window.addEventListener('pagehide', () => { token = ''; });

async function initialize() {
  try {
    if (!token) throw new Error('Reopen the capability URL returned by chat.dashboard.open or npm run dashboard. The token is not stored across reloads.');
    const registry = await api('/api/tools');
    tools = registry.tools;
    navigation();
    selectTool(tools.find(tool => tool.name === 'chat.health'));
    await refreshOverview();
  } catch (err) {
    $('connection').textContent = 'Disconnected';
    status(err.message, true);
  }
}
initialize();
