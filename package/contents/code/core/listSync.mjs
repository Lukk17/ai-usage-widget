export function planListSync(currentKeys, nextKeys) {
  const working = Array.prototype.slice.call(currentKeys);
  const plan = [];
  for (let index = working.length - 1; index >= 0; index -= 1) {
    if (nextKeys.indexOf(working[index]) === -1) {
      plan.push({ op: 'remove', index: index });
      working.splice(index, 1);
    }
  }
  nextKeys.forEach((key, index) => {
    if (working[index] === key) {
      return;
    }
    const from = working.indexOf(key);
    if (from === -1) {
      plan.push({ op: 'insert', index: index, key: key });
      working.splice(index, 0, key);
      return;
    }
    plan.push({ op: 'move', from: from, to: index });
    working.splice(from, 1);
    working.splice(index, 0, key);
  });
  return plan;
}

export function applyPlan(keys, plan) {
  const result = Array.prototype.slice.call(keys);
  plan.forEach((step) => {
    if (step.op === 'remove') {
      result.splice(step.index, 1);
    } else if (step.op === 'insert') {
      result.splice(step.index, 0, step.key);
    } else {
      const moved = result.splice(step.from, 1)[0];
      result.splice(step.to, 0, moved);
    }
  });
  return result;
}
