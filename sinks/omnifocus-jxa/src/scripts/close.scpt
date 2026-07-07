// OmniFocus JXA: mark a task complete by id.
// Invoked as: osascript -l JavaScript close.scpt '<json>'
// where <json> = { id }
// Prints { id, completed: true } on success.

function run(argv) {
  'use strict';
  var args = JSON.parse(argv[0] || '{}');
  var id = args.id;
  if (!id) {
    console.error('close_task: id is required');
    return JSON.stringify({ error: 'id is required' });
  }

  var of = Application('OmniFocus');
  of.includeStandardAdditions = true;
  var doc = of.defaultDocument;

  var matched = doc.flattenedTasks.whose({ id: id })();
  if (!matched || matched.length === 0) {
    return JSON.stringify({ error: 'task not found: ' + id });
  }

  var task = matched[0];
  task.completed.set(true);
  return JSON.stringify({ id: id, completed: true });
}
