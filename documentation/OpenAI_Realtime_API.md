Realtime API
Beta
Build low-latency, multi-modal experiences with the Realtime API.
The OpenAI Realtime API enables low-latency, multimodal interactions including speech-to-speech conversational experiences and real-time transcription.

This API works with natively multimodal models such as GPT-4o and GPT-4o mini, offering capabilities such as real-time text and audio processing, function calling, and speech generation, and with the latest transcription models GPT-4o Transcribe and GPT-4o mini Transcribe.

Get started with the Realtime API
Just getting started with Realtime? Try the new Agents SDK for TypeScript, optimized for building voice agents with Realtime models.

You can connect to the Realtime API in two ways:

Using WebRTC, which is ideal for client-side applications (for example, a web app)
Using WebSockets, which is great for server-to-server applications (from your backend or if you're building a voice agent over phone for example)
Start by exploring examples and partner integrations below, or learn how to connect to the Realtime API using the most relevant method for your use case below.

Example applications
Check out one of the example applications below to see the Realtime API in action.

Realtime Console
To get started quickly, download and configure the Realtime console demo. See events flowing back and forth, and inspect their contents. Learn how to execute custom logic with function calling.

Realtime Solar System demo
A demo of the Realtime API with the WebRTC integration, navigating the solar system through voice thanks to function calling.

Twilio Integration Demo
A demo combining the Realtime API with Twilio to build an AI calling assistant.

Realtime API Agents Demo
A demonstration of handoffs between Realtime API voice agents with reasoning model validation.

Partner integrations
Check out these partner integrations, which use the Realtime API in frontend applications and telephony use cases.

LiveKit integration guide
How to use the Realtime API with LiveKit's WebRTC infrastructure.

Twilio integration guide
Build Realtime apps using Twilio's powerful voice APIs.

Agora integration quickstart
How to integrate Agora's real-time audio communication capabilities with the Realtime API.

Pipecat integration guide
Create voice agents with OpenAI audio models and Pipecat orchestration framework.

Stream integration guide
Learn how to deploy voice agents in mobile and web applications using Stream's global edge network.

Client-side tool calling
Built with Cloudflare Workers, an example application showcasing client-side tool calling. Also check out the tutorial on YouTube.

Use cases
The most common use case for the Realtime API is to build a real-time, speech-to-speech, conversational experience. This is great for building voice agents and other voice-enabled applications.

The Realtime API can also be used independently for transcription and turn detection use cases. A client can stream audio in and have Realtime API produce streaming transcripts when speech is detected.

Both use-cases benefit from built-in voice activity detection (VAD) to automatically detect when a user is done speaking. This can be helpful to seamlessly handle conversation turns, or to analyze transcriptions one phrase at a time.

Learn more about these use cases in the dedicated guides.

Realtime Speech-to-Speech
Learn to use the Realtime API for streaming speech-to-speech conversations.

Realtime Transcription
Learn to use the Realtime API for transcription-only use cases.

Depending on your use case (conversation or transcription), you should initialize a session in different ways. Use the switcher below to see the details for each case.

Connect with WebRTC
WebRTC is a powerful set of standard interfaces for building real-time applications. The OpenAI Realtime API supports connecting to realtime models through a WebRTC peer connection. Follow this guide to learn how to configure a WebRTC connection to the Realtime API.

Overview
In scenarios where you would like to connect to a Realtime model from an insecure client over the network (like a web browser), we recommend using the WebRTC connection method. WebRTC is better equipped to handle variable connection states, and provides a number of convenient APIs for capturing user audio inputs and playing remote audio streams from the model.

Connecting to the Realtime API from the browser should be done with an ephemeral API key, generated via the OpenAI REST API. The process for initializing a WebRTC connection is as follows (assuming a web browser client):

A browser makes a request to a developer-controlled server to mint an ephemeral API key.
The developer's server uses a standard API key to request an ephemeral key from the OpenAI REST API, and returns that new key to the browser. Note that ephemeral keys currently expire one minute after being issued.
The browser uses the ephemeral key to authenticate a session directly with the OpenAI Realtime API as a WebRTC peer connection.
connect to realtime via WebRTC

While it is technically possible to use a standard API key to authenticate client-side WebRTC sessions, this is a dangerous and insecure practice because it leaks your secret key. Standard API keys grant access to your full OpenAI API account, and should only be used in secure server-side environments. We recommend ephemeral keys in client-side applications whenever possible.

Connection details
Connecting via WebRTC requires the following connection information:

URL	
https://api.openai.com/v1/realtime

Query Parameters	
model

Realtime model ID to connect to, like gpt-4o-realtime-preview-2025-06-03

Headers	
Authorization: Bearer EPHEMERAL_KEY

Substitute EPHEMERAL_KEY with an ephemeral API token - see below for details on how to generate one.

The following example shows how to initialize a WebRTC session (including the data channel to send and receive Realtime API events). It assumes you have already fetched an ephemeral API token (example server code for this can be found in the next section).

async function init() {
  // Get an ephemeral key from your server - see server code below
  const tokenResponse = await fetch("/session");
  const data = await tokenResponse.json();
  const EPHEMERAL_KEY = data.client_secret.value;

  // Create a peer connection
  const pc = new RTCPeerConnection();

  // Set up to play remote audio from the model
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = e => audioEl.srcObject = e.streams[0];

  // Add local audio track for microphone input in the browser
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
  pc.addTrack(ms.getTracks()[0]);

  // Set up data channel for sending and receiving events
  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", (e) => {
    // Realtime server events appear here!
    console.log(e);
  });

  // Start the session using the Session Description Protocol (SDP)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2025-06-03";
  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${EPHEMERAL_KEY}`,
      "Content-Type": "application/sdp"
    },
  });

  const answer = {
    type: "answer",
    sdp: await sdpResponse.text(),
  };
  await pc.setRemoteDescription(answer);
}

init();
The WebRTC APIs provide rich controls for handling media streams and input devices. For more guidance on building user interfaces on top of WebRTC, refer to the docs on MDN.

Creating an ephemeral token
To create an ephemeral token to use on the client-side, you will need to build a small server-side application (or integrate with an existing one) to make an OpenAI REST API request for an ephemeral key. You will use a standard API key to authenticate this request on your backend server.

Below is an example of a simple Node.js express server which mints an ephemeral API key using the REST API:

import express from "express";

const app = express();

// An endpoint which would work with the client code above - it returns
// the contents of a REST API request to this protected endpoint
app.get("/session", async (req, res) => {
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2025-06-03",
      voice: "verse",
    }),
  });
  const data = await r.json();

  // Send back the JSON we received from the OpenAI REST API
  res.send(data);
});

app.listen(3000);
You can create a server endpoint like this one on any platform that can send and receive HTTP requests. Just ensure that you only use standard OpenAI API keys on the server, not in the browser.

Sending and receiving events
To learn how to send and receive events over the WebRTC data channel, refer to the Realtime conversations guide.

Connect with WebSockets
WebSockets are a broadly supported API for realtime data transfer, and a great choice for connecting to the OpenAI Realtime API in server-to-server applications. For browser and mobile clients, we recommend connecting via WebRTC.

Overview
In a server-to-server integration with Realtime, your backend system will connect via WebSocket directly to the Realtime API. You can use a standard API key to authenticate this connection, since the token will only be available on your secure backend server.

connect directly to realtime API

WebSocket connections can also be authenticated with an ephemeral client token (as shown above in the WebRTC section) if you choose to connect to the Realtime API via WebSocket on a client device.


Standard OpenAI API tokens should only be used in secure server-side environments.

Connection details

Speech-to-Speech

Transcription
Connecting via WebSocket requires the following connection information:

URL	
wss://api.openai.com/v1/realtime

Query Parameters	
model

Realtime model ID to connect to, like gpt-4o-realtime-preview-2025-06-03

Headers	
Authorization: Bearer YOUR_API_KEY

Substitute YOUR_API_KEY with a standard API key on the server, or an ephemeral token on insecure clients (note that WebRTC is recommended for this use case).

OpenAI-Beta: realtime=v1

This header is required during the beta period.

Below are several examples of using these connection details to initialize a WebSocket connection to the Realtime API.


ws module (Node.js)

websocket-client (Python)

WebSocket (browsers)
Connect using the ws module (Node.js)
import WebSocket from "ws";

const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
const ws = new WebSocket(url, {
  headers: {
    "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
    "OpenAI-Beta": "realtime=v1",
  },
});

ws.on("open", function open() {
  console.log("Connected to server.");
});

ws.on("message", function incoming(message) {
  console.log(JSON.parse(message.toString()));
});
Sending and receiving events
To learn how to send and receive events over Websockets, refer to the Realtime conversations guide.

Handling audio with WebSockets
When sending and receiving audio over a WebSocket, you will have a bit more work to do in order to send media from the client, and receive media from the server. Below, you'll find a table describing the flow of events during a WebSocket session that are necessary to send and receive audio over the WebSocket.

The events below are given in lifecycle order, though some events (like the delta events) may happen concurrently.

Lifecycle stage	Client events	Server events
Session initialization	
session.update

session.created

session.updated

User audio input	
conversation.item.create
  (send whole audio message)

input_audio_buffer.append
  (stream audio in chunks)

input_audio_buffer.commit
  (used when VAD is disabled)

response.create
  (used when VAD is disabled)

input_audio_buffer.speech_started

input_audio_buffer.speech_stopped

input_audio_buffer.committed

Server audio output	
input_audio_buffer.clear
  (used when VAD is disabled)

conversation.item.created

response.created

response.output_item.created

response.content_part.added

response.audio.delta

response.audio_transcript.delta

response.text.delta

response.audio.done

response.audio_transcript.done

response.text.done

response.content_part.done

response.output_item.done

response.done

rate_limits.updated

Streaming audio input to the server
To stream audio input to the server, you can use the input_audio_buffer.append client event. This event requires you to send chunks of Base64-encoded audio bytes to the Realtime API over the socket. Each chunk cannot exceed 15 MB in size.

The format of the input chunks can be configured either for the entire session, or per response.

Session: session.input_audio_format in session.update
Response: response.input_audio_format in response.create
Append audio input bytes to the conversation
import fs from 'fs';
import decodeAudio from 'audio-decode';

// Converts Float32Array of audio data to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
base64EncodeAudio(float32Array) {
  const arrayBuffer = floatTo16BitPCM(float32Array);
  let binary = '';
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Fills the audio buffer with the contents of three files,
// then asks the model to generate a response.
const files = [
  './path/to/sample1.wav',
  './path/to/sample2.wav',
  './path/to/sample3.wav'
];

for (const filename of files) {
  const audioFile = fs.readFileSync(filename);
  const audioBuffer = await decodeAudio(audioFile);
  const channelData = audioBuffer.getChannelData(0);
  const base64Chunk = base64EncodeAudio(channelData);
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: base64Chunk
  }));
});

ws.send(JSON.stringify({type: 'input_audio_buffer.commit'}));
ws.send(JSON.stringify({type: 'response.create'}));
Send full audio messages
It is also possible to create conversation messages that are full audio recordings. Use the conversation.item.create client event to create messages with input_audio content.

Create full audio input conversation items
const fullAudio = "<a base64-encoded string of audio bytes>";

const event = {
  type: "conversation.item.create",
  item: {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_audio",
        audio: fullAudio,
      },
    ],
  },
};

// WebRTC data channel and WebSocket both have .send()
dataChannel.send(JSON.stringify(event));
Working with audio output from a WebSocket
To play output audio back on a client device like a web browser, we recommend using WebRTC rather than WebSockets. WebRTC will be more robust sending media to client devices over uncertain network conditions.

But to work with audio output in server-to-server applications using a WebSocket, you will need to listen for response.audio.delta events containing the Base64-encoded chunks of audio data from the model. You will either need to buffer these chunks and write them out to a file, or maybe immediately stream them to another source like a phone call with Twilio.

Note that the response.audio.done and response.done events won't actually contain audio data in them - just audio content transcriptions. To get the actual bytes, you'll need to listen for the response.audio.delta events.

The format of the output chunks can be configured either for the entire session, or per response.

Session: session.output_audio_format in session.update
Response: response.output_audio_format in response.create
Listen for response.audio.delta events
function handleEvent(e) {
  const serverEvent = JSON.parse(e.data);
  if (serverEvent.type === "response.audio.delta") {
    // Access Base64-encoded audio chunks
    // console.log(serverEvent.delta);
  }
}

// Listen for server messages (WebSocket)
ws.on("message", handleEvent);
Voice activity detection
By default, Realtime sessions have voice activity detection (VAD) enabled, which means the API will determine when the user has started or stopped speaking and respond automatically.

Read more about how to configure VAD in our voice activity detection guide.

Disable VAD
VAD can be disabled by setting turn_detection to null with the session.update client event. This can be useful for interfaces where you would like to take granular control over audio input, like push to talk interfaces.

When VAD is disabled, the client will have to manually emit some additional client events to trigger audio responses:

Manually send input_audio_buffer.commit, which will create a new user input item for the conversation.
Manually send response.create to trigger an audio response from the model.
Send input_audio_buffer.clear before beginning a new user input.
Keep VAD, but disable automatic responses
If you would like to keep VAD mode enabled, but would just like to retain the ability to manually decide when a response is generated, you can set turn_detection.interrupt_response and turn_detection.create_response to false with the session.update client event. This will retain all the behavior of VAD but not automatically create new Responses. Clients can trigger these manually with a response.create event.

This can be useful for moderation or input validation or RAG patterns, where you're comfortable trading a bit more latency in the interaction for control over inputs.

Create responses outside the default conversation
By default, all responses generated during a session are added to the session's conversation state (the "default conversation"). However, you may want to generate model responses outside the context of the session's default conversation, or have multiple responses generated concurrently. You might also want to have more granular control over which conversation items are considered while the model generates a response (e.g. only the last N number of turns).

Generating "out-of-band" responses which are not added to the default conversation state is possible by setting the response.conversation field to the string none when creating a response with the response.create client event.

When creating an out-of-band response, you will probably also want some way to identify which server-sent events pertain to this response. You can provide metadata for your model response that will help you identify which response is being generated for this client-sent event.

Create an out-of-band model response
const prompt = `
Analyze the conversation so far. If it is related to support, output
"support". If it is related to sales, output "sales".
`;

const event = {
  type: "response.create",
  response: {
    // Setting to "none" indicates the response is out of band
    // and will not be added to the default conversation
    conversation: "none",

    // Set metadata to help identify responses sent back from the model
    metadata: { topic: "classification" },
    
    // Set any other available response fields
    modalities: [ "text" ],
    instructions: prompt,
  },
};

// WebRTC data channel and WebSocket both have .send()
dataChannel.send(JSON.stringify(event));
Now, when you listen for the response.done server event, you can identify the result of your out-of-band response.

Create an out-of-band model response
function handleEvent(e) {
  const serverEvent = JSON.parse(e.data);
  if (
    serverEvent.type === "response.done" &&
    serverEvent.response.metadata?.topic === "classification"
  ) {
    // this server event pertained to our OOB model response
    console.log(serverEvent.response.output[0]);
  }
}

// Listen for server messages (WebRTC)
dataChannel.addEventListener("message", handleEvent);

// Listen for server messages (WebSocket)
// ws.on("message", handleEvent);
Create a custom context for responses
You can also construct a custom context that the model will use to generate a response, outside the default/current conversation. This can be done using the input array on a response.create client event. You can use new inputs, or reference existing input items in the conversation by ID.

Listen for out-of-band model response with custom context
const event = {
  type: "response.create",
  response: {
    conversation: "none",
    metadata: { topic: "pizza" },
    modalities: [ "text" ],

    // Create a custom input array for this request with whatever context
    // is appropriate
    input: [
      // potentially include existing conversation items:
      {
        type: "item_reference",
        id: "some_conversation_item_id"
      },
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Is it okay to put pineapple on pizza?",
          },
        ],
      },
    ],
  },
};

// WebRTC data channel and WebSocket both have .send()
dataChannel.send(JSON.stringify(event));
Create responses with no context
You can also insert responses into the default conversation, ignoring all other instructions and context. Do this by setting input to an empty array.

Insert no-context model responses into the default conversation
const prompt = `
Say exactly the following:
I'm a little teapot, short and stout! 
This is my handle, this is my spout!
`;

const event = {
  type: "response.create",
  response: {
    // An empty input array removes existing context
    input: [],
    instructions: prompt,
  },
};

// WebRTC data channel and WebSocket both have .send()
dataChannel.send(JSON.stringify(event));
Function calling
The Realtime models also support function calling, which enables you to execute custom code to extend the capabilities of the model. Here's how it works at a high level:

When updating the session or creating a response, you can specify a list of available functions for the model to call.
If when processing input, the model determines it should make a function call, it will add items to the conversation representing arguments to a function call.
When the client detects conversation items that contain function call arguments, it will execute custom code using those arguments
When the custom code has been executed, the client will create new conversation items that contain the output of the function call, and ask the model to respond.
Let's see how this would work in practice by adding a callable function that will provide today's horoscope to users of the model. We'll show the shape of the client event objects that need to be sent, and what the server will emit in turn.

Configure callable functions
First, we must give the model a selection of functions it can call based on user input. Available functions can be configured either at the session level, or the individual response level.

Session: session.tools property in session.update
Response: response.tools property in response.create
Here's an example client event payload for a session.update that configures a horoscope generation function, that takes a single argument (the astrological sign for which the horoscope should be generated):

session.update

{
  "type": "session.update",
  "session": {
    "tools": [
      {
        "type": "function",
        "name": "generate_horoscope",
        "description": "Give today's horoscope for an astrological sign.",
        "parameters": {
          "type": "object",
          "properties": {
            "sign": {
              "type": "string",
              "description": "The sign for the horoscope.",
              "enum": [
                "Aries",
                "Taurus",
                "Gemini",
                "Cancer",
                "Leo",
                "Virgo",
                "Libra",
                "Scorpio",
                "Sagittarius",
                "Capricorn",
                "Aquarius",
                "Pisces"
              ]
            }
          },
          "required": ["sign"]
        }
      }
    ],
    "tool_choice": "auto",
  }
}
The description fields for the function and the parameters help the model choose whether or not to call the function, and what data to include in each parameter. If the model receives input that indicates the user wants their horoscope, it will call this function with a sign parameter.

Detect when the model wants to call a function
Based on inputs to the model, the model may decide to call a function in order to generate the best response. Let's say our application adds the following conversation item and attempts to generate a response:

conversation.item.create

{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "What is my horoscope? I am an aquarius."
      }
    ]
  }
}
Followed by a client event to generate a response:

response.create

{
  "type": "response.create"
}
Instead of immediately returning a text or audio response, the model will instead generate a response that contains the arguments that should be passed to a function in the developer's application. You can listen for realtime updates to function call arguments using the response.function_call_arguments.delta server event, but response.done will also have the complete data we need to call our function.

response.done

{
  "type": "response.done",
  "event_id": "event_AeqLA8iR6FK20L4XZs2P6",
  "response": {
    "object": "realtime.response",
    "id": "resp_AeqL8XwMUOri9OhcQJIu9",
    "status": "completed",
    "status_details": null,
    "output": [
      {
        "object": "realtime.item",
        "id": "item_AeqL8gmRWDn9bIsUM2T35",
        "type": "function_call",
        "status": "completed",
        "name": "generate_horoscope",
        "call_id": "call_sHlR7iaFwQ2YQOqm",
        "arguments": "{\"sign\":\"Aquarius\"}"
      }
    ],
    "usage": {
      "total_tokens": 541,
      "input_tokens": 521,
      "output_tokens": 20,
      "input_token_details": {
        "text_tokens": 292,
        "audio_tokens": 229,
        "cached_tokens": 0,
        "cached_tokens_details": { "text_tokens": 0, "audio_tokens": 0 }
      },
      "output_token_details": {
        "text_tokens": 20,
        "audio_tokens": 0
      }
    },
    "metadata": null
  }
}
In the JSON emitted by the server, we can detect that the model wants to call a custom function:

Property	Function calling purpose
response.output[0].type	When set to function_call, indicates this response contains arguments for a named function call.
response.output[0].name	The name of the configured function to call, in this case generate_horoscope
response.output[0].arguments	A JSON string containing arguments to the function. In our case, "{\"sign\":\"Aquarius\"}".
response.output[0].call_id	A system-generated ID for this function call - you will need this ID to pass a function call result back to the model.
Given this information, we can execute code in our application to generate the horoscope, and then provide that information back to the model so it can generate a response.

Provide the results of a function call to the model
Upon receiving a response from the model with arguments to a function call, your application can execute code that satisfies the function call. This could be anything you want, like talking to external APIs or accessing databases.

Once you are ready to give the model the results of your custom code, you can create a new conversation item containing the result via the conversation.item.create client event.

conversation.item.create

{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_sHlR7iaFwQ2YQOqm",
    "output": "{\"horoscope\": \"You will soon meet a new friend.\"}"
  }
}
The conversation item type is function_call_output
item.call_id is the same ID we got back in the response.done event above
item.output is a JSON string containing the results of our function call
Once we have added the conversation item containing our function call results, we again emit the response.create event from the client. This will trigger a model response using the data from the function call.

response.create

{
  "type": "response.create"
}
Error handling
The error event is emitted by the server whenever an error condition is encountered on the server during the session. Occasionally, these errors can be traced to a client event that was emitted by your application.

Unlike HTTP requests and responses, where a response is implicitly tied to a request from the client, we need to use an event_id property on client events to know when one of them has triggered an error condition on the server. This technique is shown in the code below, where the client attempts to emit an unsupported event type.

const event = {
  event_id: "my_awesome_event",
  type: "scooby.dooby.doo",
};

dataChannel.send(JSON.stringify(event));
This unsuccessful event sent from the client will emit an error event like the following:

{
  "type": "invalid_request_error",
  "code": "invalid_value",
  "message": "Invalid value: 'scooby.dooby.doo' ...",
  "param": "type",
  "event_id": "my_awesome_event"
}

## Voice Agents
Realtime Agents

Voice Agents use OpenAI speech-to-speech models to provide realtime voice chat. These models support streaming audio, text, and tool calls and are great for applications like voice/phone customer support, mobile app experiences, and voice chat.

The Voice Agents SDK provides a TypeScript client for the OpenAI Realtime API.

Voice Agents Quickstart
Build your first realtime voice assistant using the OpenAI Agents SDK in minutes.
Key features
Connect over WebSocket or WebRTC
Can be used both in the browser and for backend connections
Audio and interruption handling
Multi-agent orchestration through handoffs
Tool definition and calling
Custom guardrails to monitor model output
Callbacks for streamed events
Reuse the same components for both text and voice agents
By using speech-to-speech models, we can leverage the model’s ability to process the audio in realtime without the need of transcribing and reconverting the text back to audio after the model acted.

## Building Voice Agents
Audio handling
Some transport layers like the default OpenAIRealtimeWebRTC will handle audio input and output automatically for you. For other transport mechanisms like OpenAIRealtimeWebSocket you will have to handle session audio yourself:

import {
  RealtimeAgent,
  RealtimeSession,
  TransportLayerAudio,
} from '@openai/agents/realtime';

const agent = new RealtimeAgent({ name: 'My agent' });
const session = new RealtimeSession(agent);
const newlyRecordedAudio = new ArrayBuffer(0);

session.on('audio', (event: TransportLayerAudio) => {
  // play your audio
});

// send new audio to the agent
session.sendAudio(newlyRecordedAudio);

Session configuration
You can configure your session by passing additional options to either the RealtimeSession during construction or when you call connect(...).

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
  config: {
    inputAudioFormat: 'pcm16',
    outputAudioFormat: 'pcm16',
    inputAudioTranscription: {
      model: 'gpt-4o-mini-transcribe',
    },
  },
});

These transport layers allow you to pass any parameter that matches session.

For parameters that are new and don’t have a matching parameter in the RealtimeSessionConfig you can use providerData. Anything passed in providerData will be passed directly as part of the session object.

Handoffs
Similarly to regular agents, you can use handoffs to break your agent into multiple agents and orchestrate between them to improve the performance of your agents and better scope the problem.

import { RealtimeAgent } from '@openai/agents/realtime';

const mathTutorAgent = new RealtimeAgent({
  name: 'Math Tutor',
  handoffDescription: 'Specialist agent for math questions',
  instructions:
    'You provide help with math problems. Explain your reasoning at each step and include examples',
});

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
  handoffs: [mathTutorAgent],
});

Unlike regular agents, handoffs behave slightly differently for Realtime Agents. When a handoff is performed, the ongoing session will be updated with the new agent configuration. Because of this, the agent automatically has access to the ongoing conversation history and input filters are currently not applied.

Additionally, this means that the voice or model cannot be changed as part of the handoff. You can also only connect to other Realtime Agents. If you need to use a different model, for example a reasoning model like o4-mini, you can use delegation through tools.

Tools
Just like regular agents, Realtime Agents can call tools to perform actions. You can define a tool using the same tool() function that you would use for a regular agent.

import { tool, RealtimeAgent } from '@openai/agents/realtime';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Return the weather for a city.',
  parameters: z.object({ city: z.string() }),
  async execute({ city }) {
    return `The weather in ${city} is sunny.`;
  },
});

const weatherAgent = new RealtimeAgent({
  name: 'Weather assistant',
  instructions: 'Answer weather questions.',
  tools: [getWeather],
});

You can only use function tools with Realtime Agents and these tools will be executed in the same place as your Realtime Session. This means if you are running your Realtime Session in the browser, your tool will be executed in the browser. If you need to perform more sensitive actions, you can make an HTTP request within your tool to your backend server.

While the tool is executing the agent will not be able to process new requests from the user. One way to improve the experience is by telling your agent to announce when it is about to execute a tool or say specific phrases to buy the agent some time to execute the tool.

Accessing the conversation history
Additionally to the arguments that the agent called a particular tool with, you can also access a snapshot of the current conversation history that is tracked by the Realtime Session. This can be useful if you need to perform a more complex action based on the current state of the conversation or are planning to use tools for delegation.

import {
  tool,
  RealtimeContextData,
  RealtimeItem,
} from '@openai/agents/realtime';
import { z } from 'zod';

const parameters = z.object({
  request: z.string(),
});

const refundTool = tool<typeof parameters, RealtimeContextData>({
  name: 'Refund Expert',
  description: 'Evaluate a refund',
  parameters,
  execute: async ({ request }, details) => {
    // The history might not be available
    const history: RealtimeItem[] = details?.context?.history ?? [];
    // making your call to process the refund request
  },
});

Note

The history passed in is a snapshot of the history at the time of the tool call. The transcription of the last thing the user said might not be available yet.

Approval before tool execution
If you define your tool with needsApproval: true the agent will emit a tool_approval_requested event before executing the tool.

By listening to this event you can show a UI to the user to approve or reject the tool call.

import { session } from './agent';

session.on('tool_approval_requested', (_context, _agent, request) => {
  // show a UI to the user to approve or reject the tool call
  // you can use the `session.approve(...)` or `session.reject(...)` methods to approve or reject the tool call

  session.approve(request.approvalItem); // or session.reject(request.rawItem);
});

Note

While the voice agent is waiting for approval for the tool call, the agent won’t be able to process new requests from the user.

Guardrails
Guardrails offer a way to monitor whether what the agent has said violated a set of rules and immediately cut off the response. These guardrail checks will be performed based on the transcript of the agent’s response and therefore requires that the text output of your model is enabled (it is enabled by default).

The guardrails that you provide will run asynchronously as a model response is returned, allowing you to cut off the response based a predefined classification trigger, for example “mentions a specific banned word”.

When a guardrail trips the session emits a guardrail_tripped event.

import { RealtimeOutputGuardrail, RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

const guardrails: RealtimeOutputGuardrail[] = [
  {
    name: 'No mention of Dom',
    async execute({ agentOutput }) {
      const domInOutput = agentOutput.includes('Dom');
      return {
        tripwireTriggered: domInOutput,
        outputInfo: { domInOutput },
      };
    },
  },
];

const guardedSession = new RealtimeSession(agent, {
  outputGuardrails: guardrails,
});

By default guardrails are run every 100 characters or at the end of the response text has been generated. Since speaking out the text normally takes longer it means that in most cases the guardrail should catch the violation before the user can hear it.

If you want to modify this behavior you can pass a outputGuardrailSettings object to the session.

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

const guardedSession = new RealtimeSession(agent, {
  outputGuardrails: [
    /*...*/
  ],
  outputGuardrailSettings: {
    debounceTextLength: 500, // run guardrail every 500 characters or set it to -1 to run it only at the end
  },
});

Turn detection / voice activity detection
The Realtime Session will automatically detect when the user is speaking and trigger new turns using the built-in voice activity detection modes of the Realtime API.

You can change the voice activity detection mode by passing a turnDetection object to the session.

import { RealtimeSession } from '@openai/agents/realtime';
import { agent } from './agent';

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
  config: {
    turnDetection: {
      type: 'semantic_vad',
      eagerness: 'medium',
      create_response: true,
      interrupt_response: true,
    },
  },
});

Modifying the turn detection settings can help calibrate unwanted interruptions and dealing with silence. Check out the Realtime API documentation for more details on the different settings

Interruptions
When using the built-in voice activity detection, speaking over the agent automatically triggers the agent to detect and update its context based on what was said. It will also emit an audio_interrupted event. This can be used to immediately stop all audio playback (only applicable to WebSocket connections).

import { session } from './agent';

session.on('audio_interrupted', () => {
  // handle local playback interruption
});

If you want to perform a manual interruption, for example if you want to offer a “stop” button in your UI, you can call interrupt() manually:

import { session } from './agent';

session.interrupt();
// this will still trigger the `audio_interrupted` event for you
// to cut off the audio playback when using WebSockets

In either way, the Realtime Session will handle both interrupting the generation of the agent, truncate its knowledge of what was said to the user, and update the history.

If you are using WebRTC to connect to your agent, it will also clear the audio output. If you are using WebSocket, you will need to handle this yourself by stopping audio playack of whatever has been queued up to be played.

Text input
If you want to send text input to your agent, you can use the sendMessage method on the RealtimeSession.

This can be useful if you want to enable your user to interface in both modalities with the agent, or to provide additional context to the conversation.

import { RealtimeSession, RealtimeAgent } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
});

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
});

session.sendMessage('Hello, how are you?');

Conversation history management
The RealtimeSession automatically manages the conversation history in a history property:

You can use this to render the history to the customer or perform additional actions on it. As this history will constantly change during the course of the conversation you can listen for the history_updated event.

If you want to modify the history, like removing a message entirely or updating its transcript, you can use the updateHistory method.

import { RealtimeSession, RealtimeAgent } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
});

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
});

await session.connect({ apiKey: '<client-api-key>' });

// listening to the history_updated event
session.on('history_updated', (history) => {
  // returns the full history of the session
  console.log(history);
});

// Option 1: explicit setting
session.updateHistory([
  /* specific history */
]);

// Option 2: override based on current state like removing all agent messages
session.updateHistory((currentHistory) => {
  return currentHistory.filter(
    (item) => !(item.type === 'message' && item.role === 'assistant'),
  );
});

Limitations
You can currently not update/change function tool calls after the fact
Text output in the history requires transcripts and text modalities to be enabled
Responses that were truncated due to an interruption do not have a transcript
Delegation through tools
Delegation through tools

By combining the conversation history with a tool call, you can delegate the conversation to another backend agent to perform a more complex action and then pass it back as the result to the user.

import {
  RealtimeAgent,
  RealtimeContextData,
  tool,
} from '@openai/agents/realtime';
import { handleRefundRequest } from './serverAgent';
import z from 'zod';

const refundSupervisorParameters = z.object({
  request: z.string(),
});

const refundSupervisor = tool<
  typeof refundSupervisorParameters,
  RealtimeContextData
>({
  name: 'escalateToRefundSupervisor',
  description: 'Escalate a refund request to the refund supervisor',
  parameters: refundSupervisorParameters,
  execute: async ({ request }, details) => {
    // This will execute on the server
    return handleRefundRequest(request, details?.context?.history ?? []);
  },
});

const agent = new RealtimeAgent({
  name: 'Customer Support',
  instructions:
    'You are a customer support agent. If you receive any requests for refunds, you need to delegate to your supervisor.',
  tools: [refundSupervisor],
});

The code below will then be executed on the server. In this example through a server actions in Next.js.

// This runs on the server
import 'server-only';

import { Agent, run } from '@openai/agents';
import type { RealtimeItem } from '@openai/agents/realtime';
import z from 'zod';

const agent = new Agent({
  name: 'Refund Expert',
  instructions:
    'You are a refund expert. You are given a request to process a refund and you need to determine if the request is valid.',
  model: 'o4-mini',
  outputType: z.object({
    reasong: z.string(),
    refundApproved: z.boolean(),
  }),
});

export async function handleRefundRequest(
  request: string,
  history: RealtimeItem[],
) {
  const input = `
The user has requested a refund.

The request is: ${request}

Current conversation history:
${JSON.stringify(history, null, 2)}
`.trim();

  const result = await run(agent, input);

  return JSON.stringify(result.finalOutput, null, 2);
}

## Realtime Transport Layer
Default transport layers
Connecting over WebRTC
The default transport layer uses WebRTC. Audio is recorded from the microphone and played back automatically.

To use your own media stream or audio element, provide an OpenAIRealtimeWebRTC instance when creating the session.

import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

async function main() {
  const transport = new OpenAIRealtimeWebRTC({
    mediaStream: await navigator.mediaDevices.getUserMedia({ audio: true }),
    audioElement: document.createElement('audio'),
  });

  const customSession = new RealtimeSession(agent, { transport });
}

Connecting over WebSocket
Pass transport: 'websocket' or an instance of OpenAIRealtimeWebSocket when creating the session to use a WebSocket connection instead of WebRTC. This works well for server-side use cases, for example building a phone agent with Twilio.

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

const myRecordedArrayBuffer = new ArrayBuffer(0);

const wsSession = new RealtimeSession(agent, {
  transport: 'websocket',
  model: 'gpt-4o-realtime-preview-2025-06-03',
});
await wsSession.connect({ apiKey: process.env.OPENAI_API_KEY! });

wsSession.on('audio', (event) => {
  // event.data is a chunk of PCM16 audio
});

wsSession.sendAudio(myRecordedArrayBuffer);

Use any recording/playback library to handle the raw PCM16 audio bytes.

Building your own transport mechanism
If you want to use a different speech-to-speech API or have your own custom transport mechanism, you can create your own by implementing the RealtimeTransportLayer interface and emit the RealtimeTranportEventTypes events.

Interacting with the Realtime API more directly
If you want to use the OpenAI Realtime API but have more direct access to the Realtime API, you have two options:

Option 1 - Accessing the transport layer
If you still want to benefit from all of the capabilities of the RealtimeSession you can access your transport layer through session.transport.

The transport layer will emit every event it receives under the * event and you can send raw events using the sendEvent() method.

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions: 'Greet the user with cheer and answer questions.',
});

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
});

session.transport.on('*', (event) => {
  // JSON parsed version of the event received on the connection
});

// Send any valid event as JSON. For example triggering a new response
session.transport.sendEvent({
  type: 'response.create',
  // ...
});

Option 2 — Only using the transport layer
If you don’t need automatic tool execution, guardrails, etc. you can also use the transport layer as a “thin” client that just manages connection and interruptions.

import { OpenAIRealtimeWebRTC } from '@openai/agents/realtime';

const client = new OpenAIRealtimeWebRTC();
const audioBuffer = new ArrayBuffer(0);

await client.connect({
  apiKey: '<api key>',
  model: 'gpt-4o-mini-realtime-preview',
  initialSessionConfig: {
    instructions: 'Speak like a pirate',
    voice: 'ash',
    modalities: ['text', 'audio'],
    inputAudioFormat: 'pcm16',
    outputAudioFormat: 'pcm16',
  },
});

// optionally for WebSockets
client.on('audio', (newAudio) => {});

client.sendAudio(audioBuffer);

## Voice Agents Quickstart
Create a project

In this quickstart we will create a voice agent you can use in the browser. If you want to check out a new project, you can try out Next.js or Vite.

Terminal window
npm create vite@latest my-project --template vanilla-ts

Install the Agents SDK

Terminal window
npm install @openai/agents

Alternatively you can install @openai/agents-realtime for a standalone browser package.

Generate a client ephemeral token

As this application will run in the users browser, we need a secure way to connect to the model through the Realtime API. For this we can use a ephemeral client key that should get generated on your backend server. For testing purposes you can also generate a key using curl and your regular OpenAI API key.

Terminal window
curl -X POST https://api.openai.com/v1/realtime/sessions \
   -H "Authorization: Bearer $OPENAI_API_KEY" \
   -H "Content-Type: application/json" \
   -d '{
     "model": "gpt-4o-realtime-preview-2025-06-03"
   }'

The response will contain a client_secret.value value that you can use to connect later on. Note that this key is only valid for a short period of time and will need to be regenerated.

Create your first Agent

Creating a new RealtimeAgent is very similar to creating a regular Agent.

import { RealtimeAgent } from '@openai/agents-realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant.',
});

Create a session

Unlike a regular agent, a Voice Agent is continously running and listening inside a RealtimeSession that handles the conversation and connection to the model over time. This session will also handle the audio processing, interruptions, and a lot of the other lifecycle functionality we will cover later on.

import { RealtimeSession } from '@openai/agents-realtime';

const session = new RealtimeSession(agent, {
  model: 'gpt-4o-realtime-preview-2025-06-03',
});

The RealtimeSession constructor takes an agent as the first argument. This agent will be the first agent that your user will be able to interact with.

Connect to the session

To connect to the session you need to pass the client ephemeral token you generated earlier on.

await session.connect({ apiKey: '<client-api-key>' });

This will connect to the Realtime API using WebRTC in the browser and automatically configure your microphone and speaker for audio input and output. If you are running your RealtimeSession on a backend server (like Node.js) the SDK will automatically use WebSocket as a connection. You can learn more about the different transport layers in the Realtime Transport Layer guide.

Putting it all together

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant.',
});

const session = new RealtimeSession(agent);

// Automatically connects your microphone and audio output
// in the browser via WebRTC.
await session.connect({
  apiKey: '<client-api-key>',
});

Fire up the engines and start talking

Start up your webserver and navigate to the page that includes your new Realtime Agent code. You should see a request for microphone access. Once you grant access you should be able to start talking to your agent.

Terminal window
npm run dev





