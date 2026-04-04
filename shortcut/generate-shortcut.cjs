/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { actionOutput, buildShortcut, withVariables } = require('@joshfarrant/shortcuts-js');
const {
  URL,
  URLEncode,
  ask,
  conditional,
  createNote,
  date,
  exitShortcut,
  formatDate,
  getContentsOfURL,
  getNetworkDetails,
  text,
} = require('@joshfarrant/shortcuts-js/actions');

const thoughtInput = actionOutput('Thought Input');
const apiKeyInput = actionOutput('API Key (Edit Once)');
const encodedInput = actionOutput('Encoded Input');
const currentDate = actionOutput('Current Date');
const captureId = actionOutput('Capture ID');
const wifiName = actionOutput('Wi-Fi Name');
const cellularName = actionOutput('Carrier Name');
const networkState = actionOutput('Network State');
const API_KEY_PLACEHOLDER = 'iak_replace_me';

function buildApiSubmitAction() {
  const action = getContentsOfURL({
    method: 'POST',
    requestBodyType: 'JSON',
    headers: {
      Authorization: 'Bearer iak_placeholder',
    },
    requestBody: {
      text: 'placeholder',
    },
  });

  const headers = action?.WFWorkflowActionParameters?.WFHTTPHeaders?.Value?.WFDictionaryFieldValueItems;
  const bodyFields = action?.WFWorkflowActionParameters?.WFJSONValues?.Value?.WFDictionaryFieldValueItems;
  if (!Array.isArray(headers) || !Array.isArray(bodyFields)) {
    throw new Error('failed to build shortcut API action');
  }

  const authorizationHeader = headers.find((item) => item?.WFKey?.Value?.string === 'Authorization');
  const textField = bodyFields.find((item) => item?.WFKey?.Value?.string === 'text');
  if (!authorizationHeader || !textField) {
    throw new Error('failed to configure shortcut API action');
  }

  authorizationHeader.WFValue = withVariables`Bearer ${apiKeyInput}`;
  textField.WFValue = withVariables`${thoughtInput}`;
  return action;
}

const actions = [
  ask(
    {
      inputType: 'Text',
      question: 'what should ibx turn into todos?',
      defaultAnswer: '',
    },
    thoughtInput,
  ),
  URLEncode(
    {
      encodeMode: 'Encode',
    },
    encodedInput,
  ),
  date(
    {
      use: 'Current Date',
    },
    currentDate,
  ),
  formatDate(
    {
      dateFormat: 'Custom',
      formatString: 'yyyyMMddHHmmss',
    },
    captureId,
  ),
  text(
    {
      text: API_KEY_PLACEHOLDER,
    },
    apiKeyInput,
  ),
  conditional({
    input: '=',
    value: API_KEY_PLACEHOLDER,
    ifTrue: [exitShortcut()],
  }),
  conditional({
    input: 'Contains',
    value: 'iak_',
    ifFalse: [exitShortcut()],
  }),
  getNetworkDetails(
    {
      network: 'Wi-Fi',
      attribute: 'Network Name',
    },
    wifiName,
  ),
  getNetworkDetails(
    {
      network: 'Cellular',
      attribute: 'Carrier Name',
    },
    cellularName,
  ),
  text(
    {
      text: withVariables`${wifiName}${cellularName}`,
    },
    networkState,
  ),
  conditional({
    input: '=',
    value: '',
    ifTrue: [
      text({
        text: withVariables`IBX_QUEUE\ncaptureId: ${captureId}\ncreatedAt: ${captureId}\ntext: ${thoughtInput}`,
      }),
      createNote(),
    ],
    ifFalse: [
      URL({
        url: 'https://ibx.egeuysal.com/api/todos/generate',
      }),
      buildApiSubmitAction(),
    ],
  }),
];

const shortcut = buildShortcut(actions, {
  icon: {
    color: 20,
    glyph: 59511,
  },
  showInWidget: true,
});

const outputDir = path.join(__dirname, 'dist');
const outputPath = path.join(outputDir, 'ibx-capture.shortcut');
const publicDir = path.join(__dirname, '..', 'public', 'shortcuts');
const publicPath = path.join(publicDir, 'ibx-capture.shortcut');
const unsignedPublicPath = path.join(publicDir, 'ibx-capture-unsigned.shortcut');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(outputPath, shortcut);

try {
  execFileSync(
    'shortcuts',
    ['sign', '--mode', 'anyone', '--input', outputPath, '--output', publicPath],
    { stdio: 'pipe' },
  );
} catch (error) {
  const reason =
    error && typeof error === 'object' && 'stderr' in error && error.stderr
      ? String(error.stderr).trim()
      : String(error);
  console.error('failed to sign shortcut with `shortcuts sign --mode anyone`');
  console.error(reason);
  process.exit(1);
}

if (fs.existsSync(unsignedPublicPath)) {
  fs.rmSync(unsignedPublicPath);
}

console.log(`generated unsigned ${outputPath}`);
console.log(`generated signed ${publicPath}`);
