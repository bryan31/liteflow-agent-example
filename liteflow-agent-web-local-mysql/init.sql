CREATE DATABASE IF NOT EXISTS liteflow_agent_local CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'liteflow'@'localhost' IDENTIFIED BY 'liteflow_example';
GRANT ALL PRIVILEGES ON liteflow_agent_local.* TO 'liteflow'@'localhost';
