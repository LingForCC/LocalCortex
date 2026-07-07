// OmniFocus JXA: update an existing task by id.
// Invoked as: osascript -l JavaScript update.scpt '<json>'
// where <json> = { id, name?, note?, project? }
// Prints { id, updated: true } on success.

function run(argv) {
  'use strict';
  var args = JSON.parse(argv[0] || '{}');
  var id = args.id;
  if (!id) {
    console.error('update_task: id is required');
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

  if (typeof args.name === 'string') task.name.set(args.name);
  if (typeof args.note === 'string') task.note.set(args.note);

  // Moving to a different project (optional).
  if (args.project) {
    var projects = doc.flattenedProjects.whose({ name: args.project })();
    if (projects && projects.length > 0) {
      // Reparenting via JXA: add to the target project, which moves it.
      projects[0].tasks.push(task);
    }
  }

  return JSON.stringify({ id: id, updated: true });
}
