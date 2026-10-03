// A dialog with one field in it, which owns the field's controller.
//
// The obvious version makes a controller, awaits `showDialog`, and disposes
// the controller when the future returns. That future returns when the dialog
// *starts* to leave, and the field is still on the screen for its exit
// animation — using a controller that has just been disposed. It asserted on
// the first test that pressed OK.

import 'package:flutter/material.dart';

import 'theme.dart';

Future<String?> prompt(
  BuildContext context, {
  required String title,
  required String ok,
  required String cancel,
  String initial = '',
  String? hint,
  String? note,
  bool obscure = false,
  TextInputType? keyboard,
  Key? fieldKey,
  Key? okKey,
}) => showDialog<String>(
  context: context,
  builder: (_) => _Prompt(
    title: title,
    ok: ok,
    cancel: cancel,
    initial: initial,
    hint: hint,
    note: note,
    obscure: obscure,
    keyboard: keyboard,
    fieldKey: fieldKey,
    okKey: okKey,
  ),
);

class _Prompt extends StatefulWidget {
  const _Prompt({
    required this.title,
    required this.ok,
    required this.cancel,
    required this.initial,
    this.hint,
    this.note,
    this.obscure = false,
    this.keyboard,
    this.fieldKey,
    this.okKey,
  });

  final String title;
  final String ok;
  final String cancel;
  final String initial;
  final String? hint;
  final String? note;
  final bool obscure;
  final TextInputType? keyboard;
  final Key? fieldKey;
  final Key? okKey;

  @override
  State<_Prompt> createState() => _PromptState();
}

class _PromptState extends State<_Prompt> {
  late final _c = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    backgroundColor: palette.card,
    title: Text(widget.title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          key: widget.fieldKey,
          controller: _c,
          autofocus: true,
          obscureText: widget.obscure,
          autocorrect: !widget.obscure,
          enableSuggestions: !widget.obscure,
          keyboardType: widget.keyboard,
          onSubmitted: (v) => Navigator.pop(context, v),
          decoration: InputDecoration(hintText: widget.hint),
        ),
        if (widget.note != null) ...[
          const SizedBox(height: 10),
          Text(
            widget.note!,
            style: TextStyle(fontSize: 12, color: palette.inkSoft),
          ),
        ],
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(widget.cancel),
      ),
      TextButton(
        key: widget.okKey,
        onPressed: () => Navigator.pop(context, _c.text),
        child: Text(widget.ok),
      ),
    ],
  );
}
