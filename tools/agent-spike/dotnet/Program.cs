// The spike's Agent Framework backend: Microsoft's AG-UI host on ASP.NET Core, with a scripted
// model in place of a provider. It owns one domain tool that needs approval, and lets the model
// call the tools the page declares with each run. See ../README.md for what it showed.

using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Hosting;
using Microsoft.Agents.AI.Hosting.AGUI.AspNetCore;
using Microsoft.Extensions.AI;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAGUIServer();

// AG-UI's TypeScript schemas take an absent field, not null. The host writes null for every unset
// field, which the TypeScript client rejects outright.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);

AIFunction shutInWell = AIFunctionFactory.Create(
    (string wellId) => new { wellId, status = "shut-in" },
    "shut_in_well",
    "Shut in a well. A domain tool: it runs on this backend.");

var agent = builder.AddAIAgent("operations", (_, name) => new ChatClientAgent(
    new ScriptedChatClient(),
    new ChatClientAgentOptions
    {
        Name = name,
        ChatOptions = new() { Instructions = "You operate wells.", Tools = [new ApprovalRequiredAIFunction(shutInWell)] },
        // The AG-UI client sends the whole conversation with every run, so the session keeps none
        // of it. It keeps the approvals the agent asked for, which a resume is checked against.
        ChatHistoryProvider = new ClientOwnedHistory(),
    }));

// The session store is what lets an approval be resumed: Agent Framework honours only an approval
// it recorded when it asked. Unpartitioned here, for one user; a real backend partitions it by the
// signed-in user (the isolation key).
agent.WithInMemorySessionStore(false);

var app = builder.Build();
app.MapAGUIServer(agent, "/agent");
app.Run();

/// <summary>The conversation lives with the client; the session stores none of it.</summary>
sealed class ClientOwnedHistory : ChatHistoryProvider;

/// <summary>
/// A model that answers from the same script as the TypeScript backend's: "acknowledge" calls the
/// page's acknowledge action, "shut in" calls the domain tool, and a tool result is repeated back.
/// </summary>
sealed class ScriptedChatClient : IChatClient
{
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        var last = messages.Last();
        var result = last.Contents.OfType<FunctionResultContent>().FirstOrDefault();
        if (result is not null)
        {
            yield return Text($"Done: {JsonSerializer.Serialize(result.Result)}");
            yield break;
        }

        var text = last.Text ?? "";
        var acknowledge = options?.Tools?.FirstOrDefault(tool => tool.Name.Contains("acknowledge"));
        if (text.Contains("acknowledge") && acknowledge is not null)
        {
            yield return Call(acknowledge.Name, new() { ["alertId"] = "A-7" });
        }
        else if (text.Contains("shut in"))
        {
            yield return Call("shut_in_well", new() { ["wellId"] = "W-1" });
        }
        else
        {
            yield return Text("I have no tool for that.");
        }
    }

    static ChatResponseUpdate Text(string text) =>
        new(ChatRole.Assistant, text) { MessageId = Guid.NewGuid().ToString("N") };

    static ChatResponseUpdate Call(string name, Dictionary<string, object?> arguments) =>
        new(ChatRole.Assistant, [new FunctionCallContent($"call_{Guid.NewGuid():N}"[..13], name, arguments)])
        {
            MessageId = Guid.NewGuid().ToString("N"),
        };

    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        List<ChatResponseUpdate> updates = [];
        await foreach (var update in GetStreamingResponseAsync(messages, options, cancellationToken))
        {
            updates.Add(update);
        }
        return updates.ToChatResponse();
    }

    public object? GetService(Type serviceType, object? serviceKey = null) => null;

    public void Dispose() { }
}
