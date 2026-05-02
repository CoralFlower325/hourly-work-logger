ObjC.import("stdlib");

const app = Application.currentApplication();
app.includeStandardAdditions = true;
const title = $.getenv("HWL_TITLE").js || "Hourly Work Logger";
const promptText = $.getenv("HWL_PROMPT").js || "请记录刚才这一小时你做了什么：";

while (true) {
  Application("System Events").activate();

  const response = app.displayDialog(promptText, {
    defaultAnswer: "",
    buttons: ["提交"],
    defaultButton: "提交",
    withTitle: title,
  });

  const input = response.textReturned.trim();
  if (input.length > 0) {
    input;
    break;
  }
}
