/**
 * EventBus.js - V23
 * Small typed-ish event bus for the next architecture.
 * It does not depend on the old viewer.
 */
export class EventBus {
  constructor({ debug = false } = {}) {
    this.debug = debug;
    this.listeners = new Map();
    this.history = [];
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  once(eventName, handler) {
    const off = this.on(eventName, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(eventName, handler) {
    this.listeners.get(eventName)?.delete(handler);
  }

  emit(eventName, payload = {}) {
    const record = { eventName, payload, at: new Date().toISOString() };
    this.history.unshift(record);
    this.history = this.history.slice(0, 100);
    if (this.debug) console.log(`[V23 EventBus] ${eventName}`, payload);
    for (const handler of this.listeners.get(eventName) || []) {
      try { handler(payload); } catch (err) { console.error(`[V23 EventBus] listener failed for ${eventName}`, err); }
    }
    return record;
  }

  getSummary() {
    return {
      listenerTypes: this.listeners.size,
      listeners: Object.fromEntries([...this.listeners.entries()].map(([k, v]) => [k, v.size])),
      history: this.history.slice(0, 20),
    };
  }
}

export const V23_EVENTS = Object.freeze({
  DOCUMENT_CREATED: 'document:created',
  DOCUMENT_LOADED: 'document:loaded',
  DOCUMENT_SAVED: 'document:saved',
  PAGE_ADDED: 'page:added',
  LAYER_CHANGED: 'layer:changed',
  ENTITY_ADDED: 'entity:added',
  EDIT_APPLIED: 'edit:applied',
  PACKAGE_EXPORTED: 'package:exported',
});
