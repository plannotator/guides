// Takes an order from the order page and puts it on the counter's order board.
// Every order is for now: the board shows orders in the order they arrived.
export function placeOrder(board, form) {
  const order = { name: form.name, phone: form.phone, items: form.items, placedAt: Date.now() };
  board.push(order);
  return order;
}

// The counter's order board, oldest first.
export function boardView(board) {
  return [...board].sort((a, b) => a.placedAt - b.placedAt);
}
