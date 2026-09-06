import { describe, expect, it, vi } from 'vitest';
import { createElement, insert, remove, setAttribute, type TypeGpuNode } from './core';
import { FrameTasks } from './frame-tasks';

const frame = { timestamp: 20, delta: 0.02, elapsed: 0.02 };

describe('declarative frame tasks', () => {
  function task(parent: TypeGpuNode, update: () => void, priority = 0) {
    const node = createElement('frameTask');
    setAttribute(node, 'update', update);
    setAttribute(node, 'priority', priority);
    insert(parent, node, null);
    return node;
  }

  it('does not rediscover static scene nodes when tasks are activated or updated', () => {
    const root = createElement('scene'), group = createElement('group');
    insert(root, group, null);
    let reads = 0;
    for (let i = 0; i < 1000; i++) {
      const node = createElement('model');
      Object.defineProperty(node, 'name', { get: () => { reads++; return 'model'; } });
      insert(root, node, null);
    }
    const update = vi.fn(), node = task(group, update), tasks = new FrameTasks();
    tasks.reconcile(root); reads = 0;
    for (let i = 0; i < 10; i++) {
      setAttribute(node, 'active', i % 2 === 0);
      tasks.reconcile(root); tasks.run(frame);
    }
    expect(reads).toBe(0); expect(update).toHaveBeenCalledTimes(5);
    setAttribute(group, 'visible', false); tasks.reconcile(root); tasks.run(frame);
    setAttribute(node, 'active', true); tasks.reconcile(root); tasks.run(frame);
    expect(update).toHaveBeenCalledTimes(5);
    setAttribute(group, 'visible', true); tasks.reconcile(root); tasks.run(frame);
    expect(update).toHaveBeenCalledTimes(6);
    expect(reads).toBe(0);
  });

  it('orders by priority then tree order and reconciles active, hidden, removed, and reparented tasks', () => {
    const root = createElement('scene');
    const group = createElement('group');
    insert(root, group, null);
    const calls: string[] = [];
    const a = task(group, () => calls.push('a'));
    const b = task(root, () => calls.push('b'));
    const first = task(root, () => calls.push('first'), -1);
    const tasks = new FrameTasks();
    tasks.reconcile(root);
    tasks.run(frame);
    expect(calls.splice(0)).toEqual(['first', 'a', 'b']);
    setAttribute(group, 'visible', false);
    setAttribute(first, 'active', false);
    tasks.reconcile(root);
    tasks.run(frame);
    expect(calls.splice(0)).toEqual(['b']);
    insert(root, a, b);
    remove(b);
    setAttribute(a, 'continuous', false);
    tasks.reconcile(root);
    expect(tasks.continuous).toBe(false);
    tasks.run(frame);
    expect(calls).toEqual(['a']);
    tasks.clear();
    tasks.run(frame);
    expect(calls).toEqual(['a']);
  });

  it('snapshots membership for a frame and aborts remaining callbacks on disposal or errors', () => {
    const root = createElement('scene');
    const tasks = new FrameTasks();
    const later = vi.fn();
    const first = task(root, () => {
      task(root, later);
      tasks.reconcile(root);
    });
    tasks.reconcile(root);
    tasks.run(frame);
    expect(later).not.toHaveBeenCalled();
    setAttribute(first, 'update', () => tasks.clear());
    tasks.reconcile(root);
    tasks.run(frame);
    expect(later).not.toHaveBeenCalled();
    setAttribute(first, 'update', () => {
      throw new Error('task failed');
    });
    tasks.reconcile(root);
    expect(() => tasks.run(frame)).toThrow('task failed');
    expect(later).not.toHaveBeenCalled();
  });
});
