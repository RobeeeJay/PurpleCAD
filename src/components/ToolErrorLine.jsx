import { useStore } from "../store";

// One-line error surfaced under a tool dialog (emboss / draft / …).  The active
// tool's live preview or commit sets `toolError` to the OCC failure message, so
// a user sees WHY nothing appeared instead of a silently empty result.  Renders
// nothing when there's no error.
const ToolErrorLine = () => {
  const toolError = useStore((s) => s.toolError);
  if (!toolError) return null;
  return (
    <div className="tool-error-line" role="alert">
      {toolError}
    </div>
  );
};

export default ToolErrorLine;
