//! A tiny HTTP server on 127.0.0.1 for the updater's tests. Test code only (it is declared under
//! `#[cfg(test)]` and is never part of a build). It lets a test script each response, including
//! odd ones (no length, a wrong length, an encoding, a delay), and records every request, so a test
//! can assert that a request was or was not made and what it carried.

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Request {
    pub path: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Clone)]
pub struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    /// None: send no Content-Length. Some(n): send this one, whatever the body is.
    length: Option<usize>,
    delay: Duration,
}

impl Reply {
    pub fn ok(body: Vec<u8>) -> Reply {
        Reply { status: 200, headers: Vec::new(), length: Some(body.len()), body, delay: Duration::ZERO }
    }

    pub fn status(code: u16) -> Reply {
        Reply { status: code, headers: Vec::new(), body: Vec::new(), length: Some(0), delay: Duration::ZERO }
    }

    pub fn redirect(code: u16, location: &str) -> Reply {
        Reply::status(code).with_header("Location", location)
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Reply {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn without_length(mut self) -> Reply {
        self.length = None;
        self
    }

    pub fn declaring(mut self, length: usize) -> Reply {
        self.length = Some(length);
        self
    }

    pub fn after(mut self, delay: Duration) -> Reply {
        self.delay = delay;
        self
    }
}

pub struct Server {
    addr: SocketAddr,
    log: Arc<Mutex<Vec<Request>>>,
    stop: Arc<AtomicBool>,
}

impl Server {
    pub fn start<F>(handler: F) -> Server
    where
        F: Fn(&Request) -> Reply + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let addr = listener.local_addr().unwrap();
        let log = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let handler = Arc::new(handler);
        let (log2, stop2) = (log.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if stop2.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let (handler, log) = (handler.clone(), log2.clone());
                std::thread::spawn(move || serve(stream, &*handler, &log));
            }
        });
        Server { addr, log, stop }
    }

    /// `http://127.0.0.1:<port>` and a path.
    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    pub fn requests(&self) -> Vec<Request> {
        self.log.lock().unwrap().clone()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.addr); // wakes the accept loop so it can end
    }
}

fn serve(mut stream: TcpStream, handler: &dyn Fn(&Request) -> Reply, log: &Mutex<Vec<Request>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(1) => head.push(byte[0]),
            _ => return,
        }
        if head.len() > 16 * 1024 {
            return;
        }
    }
    let text = String::from_utf8_lossy(&head).to_string();
    let mut lines = text.split("\r\n");
    let path = lines.next().unwrap_or("").split(' ').nth(1).unwrap_or("/").to_string();
    let headers = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect();
    let request = Request { path, headers };
    log.lock().unwrap().push(request.clone());
    let reply = handler(&request);
    std::thread::sleep(reply.delay);
    let mut out = format!("HTTP/1.1 {} Status\r\nConnection: close\r\n", reply.status);
    if let Some(n) = reply.length {
        out.push_str(&format!("Content-Length: {n}\r\n"));
    }
    for (k, v) in &reply.headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    let _ = stream.write_all(out.as_bytes());
    let _ = stream.write_all(&reply.body);
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}
