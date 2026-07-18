FROM sagemath/sagemath:latest

RUN sage -pip install --no-cache-dir jupyter_kernel_gateway==3.0.1

COPY proxy.py /opt/algebrium/proxy.py

EXPOSE 8888

ENTRYPOINT ["sage", "-sh", "-c"]
CMD ["jupyter kernelgateway --KernelGatewayApp.ip=0.0.0.0 --KernelGatewayApp.port=8888 --KernelGatewayApp.allow_origin=http://127.0.0.1:4097"]
