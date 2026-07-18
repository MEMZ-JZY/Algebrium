import asyncio


async def forward(reader, writer):
    upstream_reader, upstream_writer = await asyncio.open_connection("cas", 8888)

    async def copy(source, target):
        try:
            while data := await source.read(65536):
                target.write(data)
                await target.drain()
        finally:
            target.close()

    await asyncio.gather(copy(reader, upstream_writer), copy(upstream_reader, writer))


async def main():
    server = await asyncio.start_server(forward, "0.0.0.0", 8888)
    async with server:
        await server.serve_forever()


asyncio.run(main())
