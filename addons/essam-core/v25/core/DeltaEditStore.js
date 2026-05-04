/**
 * DeltaEditStore.js
 * V25.6 - Safe delta edits model with layer dropdown polish + persistence reports.
 *
 * Stores edits as IDs only. Does not mutate the original source entities.
 */

export function createEmptyEdits() {
  return {
    schema: 'essam-delta-edits@v25.0',
    version: 'V25.6-layer-dropdown-persistence-report',
    updatedAt: new Date().toISOString(),
    hidden: [],
    deleted: [],
    movedLayer: [],
    modified: [],
  };
}

export class DeltaEditStore {
  constructor(initial = null) {
    this.hidden = new Set(initial?.hidden || []);
    this.deleted = new Set(initial?.deleted || []);
    this.movedLayer = Array.isArray(initial?.movedLayer) ? [...initial.movedLayer] : [];
    this.modified = Array.isArray(initial?.modified) ? [...initial.modified] : [];
    this.undoStack = [];
    this.redoStack = [];
    this.lastAction = null;
  }

  toJSON() {
    return {
      schema: 'essam-delta-edits@v25.0',
      version: 'V25.6-layer-dropdown-persistence-report',
      updatedAt: new Date().toISOString(),
      hidden: Array.from(this.hidden),
      deleted: Array.from(this.deleted),
      movedLayer: [...this.movedLayer],
      modified: [...this.modified],
    };
  }

  getStats() {
    return {
      hidden: this.hidden.size,
      deleted: this.deleted.size,
      movedLayer: this.movedLayer.length,
      modified: this.modified.length,
      undo: this.undoStack.length,
      redo: this.redoStack.length,
      lastAction: this.lastAction,
    };
  }

  hide(ids = [], meta = {}) {
    const clean = normalizeIds(ids).filter((id) => !this.hidden.has(id));
    if (!clean.length) return this.makeResult('hide', clean, false);
    for (const id of clean) this.hidden.add(id);
    return this.record({ type: 'hide', ids: clean, meta });
  }

  unhide(ids = [], meta = {}) {
    const clean = normalizeIds(ids).filter((id) => this.hidden.has(id));
    if (!clean.length) return this.makeResult('unhide', clean, false);
    for (const id of clean) this.hidden.delete(id);
    return this.record({ type: 'unhide', ids: clean, meta });
  }

  delete(ids = [], meta = {}) {
    const clean = normalizeIds(ids).filter((id) => !this.deleted.has(id));
    if (!clean.length) return this.makeResult('delete', clean, false);
    for (const id of clean) this.deleted.add(id);
    return this.record({ type: 'delete', ids: clean, meta });
  }

  restore(ids = [], meta = {}) {
    const clean = normalizeIds(ids).filter((id) => this.deleted.has(id));
    if (!clean.length) return this.makeResult('restore', clean, false);
    for (const id of clean) this.deleted.delete(id);
    return this.record({ type: 'restore', ids: clean, meta });
  }

  moveLayer(moves = [], meta = {}) {
    if (!Array.isArray(moves)) moves = [moves];
    const clean = moves.map((move) => ({
      id: String(move?.id || '').trim(),
      from: String(move?.from || move?.fromLayer || '').trim(),
      to: String(move?.to || move?.toLayer || '').trim(),
    })).filter((move) => move.id && move.to && move.from !== move.to);
    if (!clean.length) return this.makeResult('moveLayer', [], false);
    const ids = new Set(clean.map((move) => move.id));
    const beforeMovedLayer = [...this.movedLayer];
    this.movedLayer = this.movedLayer.filter((move) => !ids.has(String(move.id || '')));
    this.movedLayer.push(...clean.map((move) => ({ ...move, at: new Date().toISOString() })));
    return this.record({ type: 'moveLayer', ids: Array.from(ids), moves: clean, beforeMovedLayer, meta });
  }

  clearAll(meta = {}) {
    const before = this.toJSON();
    this.hidden.clear();
    this.deleted.clear();
    this.movedLayer = [];
    this.modified = [];
    return this.record({ type: 'clearAll', before, meta });
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return { ok: false, reason: 'empty-undo-stack', stats: this.getStats() };
    this.applyInverse(action);
    this.redoStack.push(action);
    this.lastAction = { type: `undo:${action.type}`, ids: action.ids || [], at: new Date().toISOString() };
    return { ok: true, action: this.lastAction, stats: this.getStats(), edits: this.toJSON() };
  }

  redo() {
    const action = this.redoStack.pop();
    if (!action) return { ok: false, reason: 'empty-redo-stack', stats: this.getStats() };
    this.applyAction(action, { fromRedo: true });
    this.undoStack.push(action);
    this.lastAction = { type: `redo:${action.type}`, ids: action.ids || [], at: new Date().toISOString() };
    return { ok: true, action: this.lastAction, stats: this.getStats(), edits: this.toJSON() };
  }

  record(action) {
    this.undoStack.push({ ...action, at: new Date().toISOString() });
    this.redoStack = [];
    this.lastAction = { type: action.type, ids: action.ids || [], at: new Date().toISOString() };
    return { ok: true, action: this.lastAction, stats: this.getStats(), edits: this.toJSON() };
  }

  applyAction(action) {
    const ids = normalizeIds(action.ids || []);
    if (action.type === 'hide') for (const id of ids) this.hidden.add(id);
    if (action.type === 'unhide') for (const id of ids) this.hidden.delete(id);
    if (action.type === 'delete') for (const id of ids) this.deleted.add(id);
    if (action.type === 'restore') for (const id of ids) this.deleted.delete(id);
    if (action.type === 'moveLayer') {
      const moveIds = new Set((action.moves || []).map((move) => String(move.id || '')));
      this.movedLayer = this.movedLayer.filter((move) => !moveIds.has(String(move.id || '')));
      this.movedLayer.push(...(action.moves || []).map((move) => ({ ...move, at: move.at || new Date().toISOString() })));
    }
    if (action.type === 'clearAll') {
      this.hidden.clear();
      this.deleted.clear();
      this.movedLayer = [];
      this.modified = [];
    }
  }

  applyInverse(action) {
    const ids = normalizeIds(action.ids || []);
    if (action.type === 'hide') for (const id of ids) this.hidden.delete(id);
    if (action.type === 'unhide') for (const id of ids) this.hidden.add(id);
    if (action.type === 'delete') for (const id of ids) this.deleted.delete(id);
    if (action.type === 'restore') for (const id of ids) this.deleted.add(id);
    if (action.type === 'moveLayer') {
      this.movedLayer = Array.isArray(action.beforeMovedLayer) ? [...action.beforeMovedLayer] : this.movedLayer.filter((move) => !ids.includes(String(move.id || '')));
    }
    if (action.type === 'clearAll' && action.before) {
      this.hidden = new Set(action.before.hidden || []);
      this.deleted = new Set(action.before.deleted || []);
      this.movedLayer = Array.isArray(action.before.movedLayer) ? [...action.before.movedLayer] : [];
      this.modified = Array.isArray(action.before.modified) ? [...action.before.modified] : [];
    }
  }

  makeResult(type, ids, ok = true) {
    return { ok, action: { type, ids, at: new Date().toISOString() }, stats: this.getStats(), edits: this.toJSON() };
  }
}

export function normalizeIds(ids) {
  if (!Array.isArray(ids)) ids = [ids];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}
