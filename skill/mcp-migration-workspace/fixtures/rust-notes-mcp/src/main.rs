//! rust-notes-mcp — a deliberately minimal rmcp server.
//!
//! TEST MATERIAL for the mcp-migration checker. Do NOT "fix" this fixture.
//! The `session_id` field below is an admin-UI cookie, NOT an MCP session id,
//! and the MCP transport is stateless stdio — there is no per-connection state
//! to migrate. An agent that tries to add session-id handling here has
//! FAILED: this is the Rust twin of `notes-mcp`.

use rmcp::{tool, transport::stdio};

/// Admin UI session (cookie-backed), unrelated to MCP.
/// Do NOT confuse this with an MCP session id — there is none.
#[derive(Clone)]
pub struct AdminSession {
    pub session_id: String,
    pub user: String,
}

#[derive(Clone)]
pub struct NotesServer {
    admin: AdminSession,
}

#[tool(tool_router)]
impl NotesServer {
    fn new() -> Self {
        NotesServer {
            admin: AdminSession {
                session_id: String::from("dev"),
                user: String::from("local"),
            },
        }
    }

    #[tool(description = "List note titles under a folder.")]
    fn list_notes(&self, #[tool(param)] folder: String) -> String {
        format!(
            "notes under {} (admin {})",
            folder, self.admin.session_id
        )
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Stateless stdio transport: every request is self-contained. No session
    // map, no session-id routing — exactly like notes-mcp's admin trap.
    let service = NotesServer::new().serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
