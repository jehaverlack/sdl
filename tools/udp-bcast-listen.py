import socket
import sys

def main():
    if len(sys.argv) != 2:
        print("Usage: python udp_listener.py <port>")
        return
    
    port = int(sys.argv[1])

    # Create a datagram socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    except socket.error as msg:
        print('Failed to create socket. ' + str(msg))
        return
    
    # Enable broadcasting mode
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

    try:
        # Bind the socket to a specific port
        sock.bind(('', port))
    except socket.error as msg:
        print('Bind failed. ' + str(msg))
        return
    
    while True:
        data, addr = sock.recvfrom(1024)
        print(data.decode())
        
if __name__ == "__main__":
    main()
