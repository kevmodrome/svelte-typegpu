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
