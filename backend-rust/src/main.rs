use std::env;
use std::process::ExitCode;

mod gif_prepare;
mod windows_native;

#[derive(Clone, Copy, Debug)]
pub struct SupportedDevice {
    pub pid: u16,
    pub name: &'static str,
    pub width: u16,
    pub height: u16,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        return emit_error("Missing command");
    }

    run_native_windows(&args)
}

fn run_native_windows(args: &[String]) -> ExitCode {
    match windows_native::run_native_command(args, &supported_devices()) {
        Ok(payload) => emit_success(&payload),
        Err(message) => emit_error(&message),
    }
}

fn supported_devices() -> [SupportedDevice; 3] {
    [
        SupportedDevice {
            pid: 0x3008,
            name: "Kraken Z3",
            width: 320,
            height: 320,
        },
        SupportedDevice {
            pid: 0x300C,
            name: "Kraken Elite",
            width: 640,
            height: 640,
        },
        SupportedDevice {
            pid: 0x3012,
            name: "Kraken Elite v2",
            width: 640,
            height: 640,
        },
    ]
}

fn emit_success(payload: &str) -> ExitCode {
    println!("{}", payload);
    ExitCode::SUCCESS
}

fn emit_error(message: &str) -> ExitCode {
    eprintln!("{{\"message\":\"{}\"}}", escape_for_json(message));
    ExitCode::from(1)
}

fn escape_for_json(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
