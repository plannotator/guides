// Every address pastebox answers, and the function that answers it.
export const ROUTES = [
  ["GET", "/", "newPage"],
  ["POST", "/pastes", "createPaste"],
  ["GET", "/p/:id", "showPaste"],
  ["GET", "/p/:id/raw", "rawPaste"],
  ["DELETE", "/p/:id", "deletePaste"],
];
