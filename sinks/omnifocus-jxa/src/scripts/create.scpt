// OmniFocus JXA: create a task.
// Invoked as: osascript -l JavaScript create.scpt '<json>'
// where <json> = { name, note?, project? }
// Prints the created task's id.

function run(argv) {
  'use strict';
  var args = JSON.parse(argv[0] || '{}');
  var name = args.name;
  var note = args.note || '';
  var projectName = args.project || null;

  if (!name) {
    console.error('create_task: name is required');
    return JSON.stringify({ error: 'name is required' });
  }

  var of = Application('OmniFocus');
  of.includeStandardAdditions = true;
  var doc = of.defaultDocument;

  // Resolve the target project (if named); null → inbox.
  var target = null;
  if (projectName) {
    var matched = doc.flattenedProjects.whose({ name: projectName })();
    if (matched && matched.length > 0) {
      target = matched[0];
    }
  }

  var task = of.Task({ name: name, note: note });
  if (target) {
    target.tasks.push(task);
  } else {
    doc.inboxTasks.push(task);
  }

  // Return the assigned primary key.
  var id = task.id();
  return JSON.stringify({ id: id, name: name });
}
